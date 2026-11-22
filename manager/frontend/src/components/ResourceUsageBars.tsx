import { Progress } from './ui'
import { computeDiskPercent, formatDiskSize } from '../lib/format'
import type { SandboxStats } from '../types'

export function ResourceUsageBars({
  stats,
  fallbackDiskMb,
}: {
  stats: SandboxStats
  fallbackDiskMb?: number | null
}) {
  const memPct =
    stats.memory_limit_mb > 0
      ? Math.round((stats.memory_usage_mb / stats.memory_limit_mb) * 100)
      : 0
  const diskPct = computeDiskPercent(stats, fallbackDiskMb)
  const diskTitle =
    stats.disk_fs_total_mb != null
      ? `${formatDiskSize(stats.disk_fs_avail_mb)} free / ${formatDiskSize(stats.disk_fs_total_mb)}`
      : undefined

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[11px]">
        <span className="text-zinc-400">CPU</span>
        <span className="font-mono text-zinc-200">{stats.cpu_percent}%</span>
      </div>
      <Progress value={Math.min(100, stats.cpu_percent)} />
      <div className="flex justify-between text-[11px]">
        <span className="text-zinc-400">MEM</span>
        <span className="font-mono text-zinc-200">
          {stats.memory_usage_mb} / {stats.memory_limit_mb} MB ({memPct}%)
        </span>
      </div>
      <Progress value={memPct} />
      <div className="flex justify-between text-[11px] pt-0.5" title={diskTitle}>
        <span className="text-zinc-400">DISK</span>
        <span className="font-mono text-zinc-200">
          {formatDiskSize(stats.disk_usage_mb ?? fallbackDiskMb)}
          {diskPct != null ? ` (${diskPct}%)` : ''}
        </span>
      </div>
      {diskPct != null && <Progress value={diskPct} />}
    </div>
  )
}
