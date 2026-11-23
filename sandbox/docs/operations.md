# 构建与运维

## 环境分层

构建参数在 Dockerfile 的 ARG 默认值里；需要通过 Compose 覆盖构建参数或做单容器调试时使用 `.env`：

| 文件 | 用途 | 是否全部注入容器 |
| --- | --- | --- |
| `.env` | Compose 构建参数与单容器调试变量 | 否（仅 `DSH_PUBLIC_URL`、`TZ` 按需传入） |
| `.env.example` | 模板 | — |

Compose 会读取 `.env` 参与构建参数与端口/容器名插值，但不再通过 `env_file` 把宿主机/构建期变量整份透传进容器；`.dockerignore` 排除了 `.env*`，因此本地配置也不会进入构建上下文。

首次准备：

```bash
cp .env.example .env
chmod 600 .env
```

构建参数有内部默认值，通常不需要额外文件；需要覆盖时用 `--build-arg` 或 shell
环境变量。
Compose 的镜像名拆成两项：

```dotenv
DSH_IMAGE_REPO=dsh-sandbox
DSH_IMAGE_TAG=latest
```

`DSH_IMAGE_TAG` 是**镜像 tag**，和构建参数 `DSH_VERSION`（DSH npm 包版本）是两件事。


## 构建

```bash
make build
# 或
docker compose build
```

直接构建使用 Dockerfile 默认值：

```bash
docker build -t dsh-sandbox:latest .
```

覆盖某个参数：

```bash
docker build \
  --build-arg DSH_VERSION=0.2.3-alpha.2 \
  --build-arg TARGETARCH=amd64 \
  -t dsh-sandbox:latest .
```

`.env` 主要供 `docker compose build` 和单容器调试的 Compose 插值使用（仅 `DSH_PUBLIC_URL`、`TZ` 会传入调试容器）；直接用 `docker build` 时无需 `.env`。

常用构建参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `DSH_VERSION` | `0.2.3-alpha.2` | `@deepseek-ai/dsh` 版本 |
| `NODE_VERSION` | `24.22.3` | Node 运行时 |
| `INSTALL_TOOLCHAIN` | `false` | 是否在构建期按顺序执行 `sandbox/toolchain/toolchain.d/*.sh` 将自定义工具链安装至 `/opt/toolchain`（默认提供 `10-dotnet.sh`） |
| `INSTALL_BROWSER` | `false` | 是否安装无头 Chromium + Xvfb |
| `WORKSPACE_UID` / `WORKSPACE_GID` | `1000` | workspace 用户 UID/GID |
| `DOCKER_REGISTRY` | `docker.io/library` | 基础镜像完整前缀 |
| `APT_MIRROR` | `deb.debian.org` | Debian 镜像源主机名或完整 URL（如 `https://mirrors.aliyun.com`） |
| `NODE_MIRROR` | `https://nodejs.org/dist` | Node.js 二进制下载镜像 URL（如 `https://mirrors.aliyun.com/nodejs-release`） |
| `NPM_REGISTRY` | 空 → 官方 npm | npm 镜像源 URL |
| `PIP_INDEX_URL` | `https://pypi.org/simple/` | PyPI 镜像源 URL，用于安装 `uv`（如 `https://mirrors.aliyun.com/pypi/simple/`） |

在内网或国内网络构建时，可在 `.env` 或 `--build-arg` 中覆盖镜像源：

```bash
docker build \
  --build-arg DOCKER_REGISTRY=your-registry.example.com/docker \
  --build-arg APT_MIRROR=https://mirrors.aliyun.com \
  --build-arg NODE_MIRROR=https://mirrors.aliyun.com/nodejs-release \
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
  --build-arg PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
  -t dsh-sandbox:latest .
```

Podman 需要保留 `HEALTHCHECK` 时使用：

```bash
podman build --format docker ... -t dsh-sandbox:latest .
```

## 启动

```bash
make up
```

`make up` 会构建、启动并等待健康检查，然后打印启动 URL。其他目标：

```bash
make down
make logs
make token
make shell
make expose NAME=web PORT=5173
```

手动运行：

```bash
docker run -d --name dsh-sandbox -p 18086:8080 \
  -e DSH_PUBLIC_URL=http://localhost:18086/dsh/ \
  -v dsh-sandbox-home:/home/workspace \
  dsh-sandbox:latest
```

修改运行时 env 后需要**重建容器**，`restart` 不会重新读取 env。

## 健康检查

```bash
curl -fsS http://127.0.0.1:8080/healthz
```

容器健康检查只依赖 Caddy 的 `/healthz`；DSH 启动失败需要看日志：

```bash
docker compose logs -f
```

## 中文支持

镜像默认：

```text
LANG=C.UTF-8
zh_CN.UTF-8 locale 已生成
fonts-wqy-microhei + fontconfig
```

- 终端/文件/Node/Python 的中文 UTF-8 直接可用；
- 需要中文 locale 的程序可以 `setlocale(LC_ALL, "zh_CN.UTF-8")`；
- 服务端渲染（matplotlib、headless browser 截图、PDF）有 CJK 字体，不再 tofu；
- 默认 `LANG` 仍是 `C.UTF-8`，避免 CLI 日期/日志随 locale 变化。

浏览器里的 DSH UI 和终端本来就使用客户端字体，不依赖容器字体。

## 镜像体积

默认基础镜像（`INSTALL_TOOLCHAIN=false`）包含 Node、Python、`uv`、`pnpm`、`Caddy`、git、build-essential、中文字体和 `@deepseek-ai/dsh`，体积约 1.9 GB。开启 `INSTALL_TOOLCHAIN=true` 时，额外层大小取决于 `sandbox/toolchain/toolchain.d/*.sh` 所装工具链（例如内置参考脚本 `10-dotnet.sh` 安装 .NET 10 SDK 约增加 ~680 MB 至 `/opt/toolchain/dotnet`）：

| 层 | 约 |
| --- | --- |
| apt 工具链 + 开发头文件 | ~620 MB |
| DSH / npm 全局依赖 | ~830 MB |
| Node.js | ~200 MB |
| `Caddy` | ~45 MB |
| `uv` | ~32 MB |
| 可选 `/opt/toolchain`（启用 `INSTALL_TOOLCHAIN=true` 时） | 视自定义脚本而定（如 .NET 10 SDK ~680 MB） |

保持默认 `INSTALL_TOOLCHAIN=false` 即为精简开发镜像；需要 Go、JDK、Rust、.NET 等环境时，按 [toolchain/README.md](../toolchain/README.md) 规范写入 `toolchain/toolchain.d/*.sh` 并传入 `--build-arg INSTALL_TOOLCHAIN=true`。

## 持久化与 UID

```yaml
volumes:
  - dsh-home:/home/workspace
```

`/home/workspace` 是沙箱默认工作目录与持久卷挂载点（`WORKDIR /home/workspace`），包含用户项目代码、DSH profile/session、模型配置、skill、用户服务、`sandbox-cron`、`apps.d` 路由和日志（平台 `/api/sandboxes/{id}/backup` 亦完整打包 `/home/workspace` 为 `<slug>-home.tar`）。删除容器不会删除 volume；`docker compose down -v` 才会。

自定义 SDK 放在 `/opt/toolchain` 下，既不污染 `/home/workspace` 备份归档，又能随容器重建立即恢复。

bind mount 时保证 UID/GID 1000 可写：

```bash
sudo chown -R 1000:1000 ./home
```

或者用 `WORKSPACE_UID` / `WORKSPACE_GID` 重新构建。

## 升级

1. 修改 `DSH_VERSION` 或基础镜像版本；
2. `make build`；
3. 重新创建容器，保留 home volume。

DSH cookie 的签名密钥在 `/home/workspace/.dsh` 中，升级后旧浏览器 cookie 仍然有效；启动 token
是进程级的，会随 DSH 重启变化。

## CA

`ca-bundle.crt` 会在构建时安装到系统信任库，并在每次启动时刷新。它包含公开 CA 证书，
不含私钥。替换为企业自己的 bundle 后重新构建即可。

## 镜像大小与缓存

基础镜像约 1.9 GB（按需启用 `INSTALL_TOOLCHAIN=true` 后随自定义 SDK 增加）。基础镜像层和 npm/pip 缓存会复用；多用户场景建议使用内部 registry，并在宿主机预构建或预拉取。