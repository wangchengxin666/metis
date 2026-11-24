import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importExternal } from './deps.mjs'
import * as hostPlugin from '../index.js'
import { buildSignedHeaders } from '../src/host/crypto.js'

const { Context } = await importExternal('@deepseek-ai/cordis')

const tempDir = mkdtempSync(join(tmpdir(), 'dsh-sandbox-mesh-'))

try {
  // -------------------------------------------------------------------------
  // Part 1: Cordis Host plugin route registration & clean disposal
  // -------------------------------------------------------------------------
  {
    const ctx = new Context()
    const routes = new Map()

    ctx.provide('connection', {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return () => { routes.delete(route.path) }
        },
      },
    })

    const storagePath = join(tempDir, 'plugin-host.json')
    const homeDir = join(tempDir, 'home-host')
    const dshHome = join(homeDir, '.dsh')
    const fiber = ctx.plugin(hostPlugin, {
      storagePath,
      homeDir,
      dshHome,
      slug: 'alice',
      ownerName: 'Alice Zhang',
      ownerEmail: 'alice@example.com',
      publicOrigin: 'https://dock.example.com',
      disableServer: true,
    })
    await fiber.inertia
    await new Promise((r) => setTimeout(r, 20))

    for (const ep of [
      hostPlugin.STATE_ENDPOINT,
      hostPlugin.PROFILE_ENDPOINT,
      hostPlugin.FILES_ENDPOINT,
      hostPlugin.FILE_DOWNLOAD_ENDPOINT,
      hostPlugin.FILE_UPLOAD_ENDPOINT,
      hostPlugin.PAIR_CODE_ENDPOINT,
      hostPlugin.PAIR_CLAIM_ENDPOINT,
      hostPlugin.GROUP_CREATE_ENDPOINT,
      hostPlugin.GROUP_INVITE_ENDPOINT,
      hostPlugin.GROUP_MODERATE_ENDPOINT,
      hostPlugin.GROUP_REMOVE_ENDPOINT,
      hostPlugin.GROUP_LEAVE_ENDPOINT,
      hostPlugin.GROUP_RENAME_ENDPOINT,
      hostPlugin.NEW_TOPIC_ENDPOINT,
      hostPlugin.SEND_ENDPOINT,
      hostPlugin.SEND_FILE_ENDPOINT,
      hostPlugin.MARK_READ_ENDPOINT,
      hostPlugin.PEER_REMOVE_ENDPOINT,
      hostPlugin.PEER_PING_ENDPOINT,
      hostPlugin.ROOM_REMOVE_ENDPOINT,
      hostPlugin.TASK_CREATE_ENDPOINT,
      hostPlugin.TASK_UPDATE_ENDPOINT,
      hostPlugin.APPROVAL_DECIDE_ENDPOINT,
    ]) {
      assert.ok(routes.has(ep), `Expected route ${ep} to be registered`)
    }

    // Verify Agent CLI & Skill were provisioned automatically (including unpair, ping, group-leave, tasks)
    const cliText = readFileSync(join(homeDir, '.local', 'bin', 'sandbox-peer'), 'utf8')
    assert.ok(cliText.includes('unpair <slug>'))
    assert.ok(cliText.includes('ping <slug>'))
    assert.ok(cliText.includes('group-leave <roomId>'))
    assert.ok(cliText.includes('tasks <roomId>'))
    assert.ok(cliText.includes('task-update <roomId>'))
    assert.ok(existsSync(join(dshHome, 'skills', 'sandbox-peer', 'SKILL.md')))

    // Verify workspace file search endpoint for `#` autocomplete
    writeFileSync(join(homeDir, 'schema.json'), '{"openapi":"3.1.0"}\n', 'utf8')
    const filesRes = await routes.get(hostPlugin.FILES_ENDPOINT).fetch(
      new Request('http://localhost/api/sandbox-mesh.files?q=schema'),
    )
    assert.equal(filesRes.status, 200)
    const filesJson = await filesRes.json()
    assert.equal(filesJson.ok, true)
    assert.ok(filesJson.files.some((f) => f.relativePath === 'schema.json'))

    // Verify STATE_ENDPOINT and PAIR_CODE_ENDPOINT
    const stateRes = await routes.get(hostPlugin.STATE_ENDPOINT).fetch(
      new Request('http://localhost/api/sandbox-mesh.state'),
    )
    assert.equal(stateRes.status, 200)
    const stateJson = await stateRes.json()
    assert.equal(stateJson.ok, true)
    assert.equal(stateJson.state.self.slug, 'alice')
    assert.equal(stateJson.state.self.endpointUrl, 'https://dock.example.com/s/alice/p/4090')

    const codeRes = await routes.get(hostPlugin.PAIR_CODE_ENDPOINT).fetch(
      new Request('http://localhost/api/sandbox-mesh.pair-code', { method: 'POST' }),
    )
    const codeJson = await codeRes.json()
    assert.equal(codeJson.ok, true)
    assert.ok(codeJson.invite.shortCode.startsWith('alice.'))
    assert.ok(codeJson.invite.inviteUri.startsWith('https://dock.example.com/s/alice/p/4090#pair=alice.'))

    await ctx.fiber.dispose()
    assert.equal(routes.size, 0, 'All routes must unregister on plugin dispose')
  }

  // -------------------------------------------------------------------------
  // Part 2: Live 3-Sandbox Mesh over simulated Traefik gateway
  // -------------------------------------------------------------------------
  {
    const nodes = new Map()

    const traefikFetch = async (url, init = {}) => {
      const parsed = new URL(url)
      const match = parsed.pathname.match(/^\/s\/([a-z0-9_-]+)\/p\/\d+(\/.*)$/i)
      assert.ok(match, `Expected Traefik subpath URL, got: ${url}`)
      const targetSlug = match[1].toLowerCase()
      const subPath = match[2]
      const targetNode = nodes.get(targetSlug)
      if (!targetNode) {
        return new Response(JSON.stringify({ ok: false, error: 'Bad Gateway' }), { status: 502 })
      }
      const headersObj = {}
      if (init.headers) {
        for (const [k, v] of Object.entries(init.headers)) {
          headersObj[k.toLowerCase()] = v
        }
      }
      const result = await targetNode.handleIncomingMeshHttp(
        init.method || 'GET',
        subPath,
        headersObj,
        init.body || '',
      )
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { 'content-type': 'application/json' },
      })
    }

    const createSandboxNode = (slug, ownerName) => {
      const nodeDir = join(tempDir, `node-${slug}`)
      const svc = hostPlugin.createMeshService({
        config: {
          storagePath: join(nodeDir, 'mesh.json'),
          homeDir: nodeDir,
          inboxDir: join(nodeDir, 'mesh-inbox'),
          slug,
          ownerName,
          ownerEmail: `${slug}@example.com`,
          publicOrigin: 'https://mesh.example.com',
          port: 4090,
          maxAgentHops: 3,
        },
        fetchImpl: traefikFetch,
      })
      nodes.set(slug, svc)
      return { svc, nodeDir }
    }

    const { svc: alice, nodeDir: aliceDir } = createSandboxNode('alice', 'Alice')
    const { svc: bob, nodeDir: bobDir } = createSandboxNode('bob', 'Bob')
    const { svc: charlie, nodeDir: charlieDir } = createSandboxNode('charlie', 'Charlie')

    // 1. Set node specialty profiles (like Remote Subagents) & Pair Alice <-> Bob
    await alice.updateProfile({
      role: 'Frontend UI Specialist',
      description: 'Owns React 19 UI components and client state',
    })
    await bob.updateProfile({
      role: 'Backend & DB Specialist',
      description: 'Owns FastAPI endpoints, SQLite schema, and auth',
    })

    const inviteForBob = alice.store.createPairCode()
    const claimBob = await bob.claimPairInvite(inviteForBob.inviteUri)
    assert.equal(claimBob.ok, true)
    assert.equal(claimBob.peer.slug, 'alice')
    assert.equal(claimBob.peer.role, 'Frontend UI Specialist')
    assert.equal(alice.store.getPeer('bob').role, 'Backend & DB Specialist')
    assert.equal(claimBob.room.id, 'pair:alice:bob')

    // Updating Bob's profile after pairing automatically syncs to Alice over /mesh/profile-sync
    await bob.updateProfile({
      role: 'Core Backend Architect',
      description: 'Owns FastAPI, Traefik gateway, and SQLite migrations',
    })
    assert.equal(alice.store.getPeer('bob').role, 'Core Backend Architect')

    // Reusing a consumed one-time pair code must fail
    const reuseAttempt = await charlie.claimPairInvite(inviteForBob.shortCode)
    assert.equal(reuseAttempt.ok, false)

    // 2. Pair Alice <-> Charlie using short code (same gateway)
    const inviteForCharlie = alice.store.createPairCode()
    const claimCharlie = await charlie.claimPairInvite(inviteForCharlie.shortCode)
    assert.equal(claimCharlie.ok, true)
    assert.equal(claimCharlie.peer.slug, 'alice')
    assert.equal(claimCharlie.room.id, 'pair:alice:charlie')

    // 3. Forged / unsigned request to /mesh/message is rejected with 401
    {
      const unsignedRes = await bob.handleIncomingMeshHttp(
        'POST',
        '/mesh/message',
        { 'content-type': 'application/json' },
        JSON.stringify({ message: { id: 'forged', roomId: 'pair:alice:bob', text: 'hack' } }),
      )
      assert.equal(unsignedRes.status, 401)

      const badHmacHeaders = buildSignedHeaders({
        method: 'POST',
        path: '/mesh/message',
        body: '{}',
        secret: 'wrong-secret',
        fromSlug: 'alice',
      })
      const badHmacRes = await bob.handleIncomingMeshHttp('POST', '/mesh/message', badHmacHeaders, '{}')
      assert.equal(badHmacRes.status, 401)
    }

    // 4. Replay attack (reusing identical nonce + signature) is rejected with 401
    {
      const sharedSecret = alice.store.getPeer('bob').sharedSecret
      const pingHeaders = buildSignedHeaders({
        method: 'POST',
        path: '/mesh/ping',
        body: '{}',
        secret: sharedSecret,
        fromSlug: 'alice',
        nonce: 'unique-nonce-123456',
      })
      const firstPing = await bob.handleIncomingMeshHttp('POST', '/mesh/ping', pingHeaders, '{}')
      assert.equal(firstPing.status, 200)

      const replayedPing = await bob.handleIncomingMeshHttp('POST', '/mesh/ping', pingHeaders, '{}')
      assert.equal(replayedPing.status, 401)
      assert.match(replayedPing.body.error, /Replayed/i)
    }

    // 5. 1-on-1 Chat + @bob-agent Wake + Hop Anti-Loop Guard
    {
      const send1 = await alice.sendMessage({
        roomId: 'pair:alice:bob',
        text: 'Hey @bob-agent please inspect the build error',
        actor: 'human',
      })
      assert.equal(send1.ok, true)
      assert.equal(send1.message.kind, 'task', '@bob-agent mention should auto-promote kind to task')
      assert.deepEqual(send1.delivery.deliveredTo, ['bob'])

      const bobInbox = bob.store.getAgentInbox({ ack: true })
      assert.equal(bobInbox.length, 1)
      assert.equal(bobInbox[0].text, 'Hey @bob-agent please inspect the build error')
      assert.equal(bob.store.getAgentInbox({ ack: false }).length, 0)

      const agentReplyAtCap = await bob.sendMessage({
        roomId: 'pair:alice:bob',
        text: '@alice-agent Here is my 3rd hop response',
        kind: 'task',
        actor: 'agent',
        hop: 3,
      })
      assert.equal(agentReplyAtCap.ok, true)
      const aliceMsgs = alice.store.getSnapshot().messages['pair:alice:bob']
      const lastAliceMsg = aliceMsgs[aliceMsgs.length - 1]
      assert.equal(lastAliceMsg.hop, 3)
      assert.equal(lastAliceMsg.wakeAgent, false)

      const overHop = await alice.sendMessage({
        roomId: 'pair:alice:bob',
        text: '@bob-agent loop forever',
        kind: 'task',
        actor: 'agent',
        hop: 4,
      })
      assert.equal(overHop.ok, false)
      assert.equal(overHop.status, 429)
    }

    // 6. Decentralized Multi-Sandbox Group & Unified `#file` inline transfer
    {
      const grpRes = await alice.createGroup({
        name: 'Core Platform Group',
        memberSlugs: ['bob', 'charlie'],
      })
      assert.equal(grpRes.ok, true)
      const groupId = grpRes.room.id
      assert.deepEqual(grpRes.sync.deliveredTo.sort(), ['bob', 'charlie'])

      const charlieGroupMsg = await charlie.sendMessage({
        roomId: groupId,
        text: 'Hello everyone from Charlie Agent!',
        actor: 'agent',
        hop: 1,
      })
      assert.equal(charlieGroupMsg.ok, true)
      assert.deepEqual(charlieGroupMsg.delivery.deliveredTo.sort(), ['alice', 'bob'])

      // 7. Unified `#api-spec.md` syntax inside sendMessage transfers the file automatically!
      const sampleFile = join(aliceDir, 'api-spec.md')
      writeFileSync(sampleFile, '# OpenAPI Spec v1\nEndpoint: /s/<slug>/p/4090\n', 'utf8')
      const unifiedSend = await alice.sendMessage({
        roomId: groupId,
        text: 'Please review #api-spec.md @bob-agent',
        actor: 'human',
      })
      assert.equal(unifiedSend.ok, true)

      for (const peerDir of [bobDir, charlieDir]) {
        const receivedFile = join(peerDir, 'mesh-inbox', groupId, 'api-spec.md')
        assert.ok(existsSync(receivedFile), `Expected shared file at ${receivedFile}`)
        assert.equal(readFileSync(receivedFile, 'utf8'), '# OpenAPI Spec v1\nEndpoint: /s/<slug>/p/4090\n')
      }
    }

    // 8. Local CLI endpoint security
    {
      const blockedProxy = await alice.handleIncomingMeshHttp(
        'POST',
        '/local/cli',
        {
          authorization: `Bearer ${alice.localToken}`,
          'x-forwarded-prefix': '/s/alice/p/4090',
        },
        JSON.stringify({ action: 'status' }),
      )
      assert.equal(blockedProxy.status, 403)

      const validCli = await alice.handleIncomingMeshHttp(
        'POST',
        '/local/cli',
        { authorization: `Bearer ${alice.localToken}` },
        JSON.stringify({ action: 'status' }),
      )
      assert.equal(validCli.status, 200)
      assert.equal(validCli.body.ok, true)
      assert.equal(validCli.body.self.slug, 'alice')
    }

    // 9. Native Harness Runtime Bridge (ctx.tools + sessionController + agent.followup -> auto-reply back to room)
    {
      const bobCtx = new Context()
      const registeredTools = []
      const createdSessions = []
      const followupMessages = []
      const sessionEvents = []

      bobCtx.provide('tools', {
        register(toolDef) {
          registeredTools.push(toolDef)
          return () => {}
        },
      })
      bobCtx.provide('agents', {
        withoutInitiator: (fn) => fn(),
      })
      bobCtx.provide('sessions', {
        flush: async () => true,
      })

      const mockBobAgent = {
        id: 'session-mesh-bob',
        session: {
          id: 'session-mesh-bob',
          snapshotEvents: () => [...sessionEvents],
        },
        followup(userMsg) {
          followupMessages.push(userMsg)
          // Simulate Bob calling mesh_share_file mid-turn; this file message must NOT suppress Bob's final text reply!
          const midTurnFile = join(bobDir, 'midturn-report.txt')
          writeFileSync(midTurnFile, 'ok\n', 'utf8')
          void bob.sendFile({
            roomId: 'pair:alice:bob',
            filePath: midTurnFile,
            text: 'attachment',
            actor: 'agent',
          })
          // Simulate Bob's Harness LLM producing an assistant reply during the turn
          sessionEvents.push({
            seq: sessionEvents.length + 1,
            type: 'assistant/message',
            data: {
              message: {
                content: [{ type: 'text', text: 'Auto-reply from Bob native Harness Agent: task completed!' }],
              },
            },
          })
          sessionEvents.push({
            seq: sessionEvents.length + 1,
            type: 'turn/end',
            data: { turn: 1, reason: { kind: 'completed' } },
          })
        },
        whenIdle: async () => {},
      }

      bobCtx.provide('sessionController', {
        async create(spec) {
          createdSessions.push(spec)
        },
        async resolveAgent() {
          if (createdSessions.length === 0) {
            return { error: new Error('not created yet') }
          }
          return { agent: mockBobAgent }
        },
      })

      const { wireHarnessRuntime } = await import('../src/host/harness-bridge.js')
      let registeredSkillProvider = null
      let skillInvalidations = 0
      bobCtx.provide('skills', {
        registerProvider(provider, onControl) {
          registeredSkillProvider = provider
          onControl?.({
            invalidate() {
              skillInvalidations += 1
            },
          })
          return () => { registeredSkillProvider = null }
        },
      })
      wireHarnessRuntime(bobCtx, bob)
      await new Promise((r) => setTimeout(r, 30))

      // Verify dynamic Skill Provider advertises connected peers & roles in description, and full specialty in get()
      assert.ok(registeredSkillProvider, 'Expected skills.registerProvider to be registered')
      const skillCandidates = await registeredSkillProvider.list({})
      assert.equal(skillCandidates.length, 1)
      assert.equal(skillCandidates[0].name, 'sandbox-peer')
      assert.ok(skillCandidates[0].description.includes('@alice (Frontend UI Specialist)'))

      const fullSkillDef = await registeredSkillProvider.get(skillCandidates[0], {})
      assert.ok(fullSkillDef.content.includes('Owns React 19 UI components and client state'))

      // Updating profile invalidates skill catalog so Agent always discovers fresh peer specialties
      await bob.updateProfile({ role: 'Updated Backend Lead', description: 'Updated desc' })
      assert.ok(skillInvalidations >= 1)

      // Verify native Harness tools mesh_list_peers, mesh_ask_peer, mesh_discuss_group, mesh_send_message & mesh_share_file were registered
      assert.ok(registeredTools.some((t) => t.name === 'mesh_list_peers'))
      assert.ok(registeredTools.some((t) => t.name === 'mesh_ask_peer'))
      assert.ok(registeredTools.some((t) => t.name === 'mesh_discuss_group'))
      assert.ok(registeredTools.some((t) => t.name === 'mesh_send_message'))
      assert.ok(registeredTools.some((t) => t.name === 'mesh_share_file'))

      // Now Alice sends "@bob Please run healthcheck" (clean @<slug>, no -agent suffix needed!) -> Bob's Harness Agent wakes up, runs turn, and replies back to Alice!
      await alice.sendMessage({
        roomId: 'pair:alice:bob',
        text: '@bob Please run healthcheck',
        actor: 'human',
      })
      await new Promise((r) => setTimeout(r, 60))

      assert.equal(createdSessions.length, 1, 'Expected Bob sessionController to create a Mesh session')
      assert.equal(followupMessages.length, 1, 'Expected Bob agent.followup() to be called with incoming mesh prompt')

      const aliceRoomMsgs = alice.store.getSnapshot().messages['pair:alice:bob']
      const bobAutoReply = aliceRoomMsgs.find(
        (m) => m.sender?.slug === 'bob' && m.sender?.actor === 'agent' && m.text.includes('Auto-reply from Bob native Harness Agent'),
      )
      assert.ok(bobAutoReply, 'Expected Bob Harness Agent assistant reply to be delivered back to Alice room')
      assert.equal(bobAutoReply.hop, 1)

      await bobCtx.fiber.dispose()
    }

    // 10. LLM-Controlled Group Moderator + Per-Container Topic Context Isolation
    {
      const wakeLog = []
      alice.setAgentWakeHandler(({ room, message }) => {
        wakeLog.push({ node: 'alice', wakeReason: message.wakeReason, threadId: message.threadId, text: message.text })
      })
      bob.setAgentWakeHandler(({ room, message }) => {
        wakeLog.push({ node: 'bob', wakeReason: message.wakeReason, threadId: message.threadId, text: message.text })
        void bob.sendMessage({
          roomId: room.id,
          threadId: message.threadId,
          phase: 'turn',
          mentionsOverride: [],
          text: 'Bob Agent: SQLite migrations & FastAPI health endpoint are clean.',
          actor: 'agent',
          hop: 1,
        })
      })
      charlie.setAgentWakeHandler(({ room, message }) => {
        wakeLog.push({ node: 'charlie', wakeReason: message.wakeReason, threadId: message.threadId, text: message.text })
      })

      const grpRes = await alice.createGroup({
        name: 'Team Sync',
        memberSlugs: ['bob', 'charlie'],
        moderatorSlug: 'alice',
      })
      assert.equal(grpRes.ok, true)
      assert.equal(grpRes.room.moderatorSlug, 'alice')
      const initialThread = grpRes.room.activeThreadId
      assert.ok(initialThread.startsWith('thr_'))

      // Un-targeted human message in group wakes ONLY Moderator (alice), never bob/charlie!
      wakeLog.length = 0
      await bob.sendMessage({
        roomId: grpRes.room.id,
        text: 'Please investigate API 500 error',
        actor: 'human',
      })
      await new Promise((r) => setTimeout(r, 30))
      assert.deepEqual(
        wakeLog.map((w) => ({ node: w.node, wakeReason: w.wakeReason, threadId: w.threadId })),
        [{ node: 'alice', wakeReason: 'group-moderator-duty', threadId: initialThread }],
        'Untargeted group message must wake ONLY the Moderator LLM',
      )

      // Moderator LLM selectively calls ONLY @bob inside the group thread; @charlie stays silent
      wakeLog.length = 0
      await alice.sendMessage({
        roomId: grpRes.room.id,
        threadId: initialThread,
        phase: 'turn',
        mentionsOverride: ['bob'],
        text: '@bob Check backend logs for the 500 error',
        kind: 'task',
        actor: 'agent',
        hop: 1,
      })
      await new Promise((r) => setTimeout(r, 40))
      assert.deepEqual(
        wakeLog.map((w) => w.node),
        ['bob'],
        'Targeted call from Moderator must wake ONLY the called member (@bob), not @charlie or @alice',
      )

      // Start a New Topic -> rotates activeThreadId across peers & completely isolates prompt + Harness Session context!
      const rotRes = await alice.startNewTopic({ roomId: grpRes.room.id })
      assert.equal(rotRes.ok, true)
      assert.equal(rotRes.alreadyFresh, false)
      assert.notEqual(rotRes.threadId, initialThread)
      assert.equal(bob.store.getRoom(grpRes.room.id).activeThreadId, rotRes.threadId)

      // Calling startNewTopic again immediately while active thread has 0 new messages must be a no-op!
      const dupRotRes = await alice.startNewTopic({ roomId: grpRes.room.id })
      assert.equal(dupRotRes.ok, true)
      assert.equal(dupRotRes.alreadyFresh, true)
      assert.equal(dupRotRes.threadId, rotRes.threadId)

      const { buildAgentWakePrompt } = await import('../src/host/harness-bridge.js')
      const freshTopicPrompt = buildAgentWakePrompt({
        self: bob.store.getSelf(),
        room: bob.store.getRoom(grpRes.room.id),
        message: {
          id: 'msg_probe_new_topic',
          threadId: rotRes.threadId,
          sender: { slug: 'alice', ownerName: 'Alice', actor: 'agent' },
          text: 'Fresh topic question',
        },
        recentMessages: bob.store.getSnapshot().messages[grpRes.room.id] || [],
      })
      assert.ok(
        !freshTopicPrompt.includes('Please investigate API 500 error'),
        'Old topic messages must NOT leak into new topic prompt context',
      )

      // Wire native tools on alice & test LLM Moderator dynamic tool flow (mesh_discuss_group + mesh_ask_peer)
      const aliceCtx = new Context()
      const aliceTools = new Map()
      aliceCtx.provide('tools', {
        register(toolDef) {
          aliceTools.set(toolDef.name, toolDef)
          return () => { aliceTools.delete(toolDef.name) }
        },
      })
      const { wireHarnessRuntime } = await import('../src/host/harness-bridge.js')
      wireHarnessRuntime(aliceCtx, alice)
      await new Promise((r) => setTimeout(r, 30))

      const discussTool = aliceTools.get('mesh_discuss_group')
      const askTool = aliceTools.get('mesh_ask_peer')
      assert.ok(discussTool && askTool)

      const grpPrep = await discussTool.execute({
        roomId: grpRes.room.id,
        topic: 'Verify DB schema cleanly',
        threadId: rotRes.threadId,
      })
      assert.equal(grpPrep.ok, true)
      assert.equal(grpPrep.isLocalModerator, true)
      assert.equal(grpPrep.moderatorSlug, 'alice')
      assert.ok(grpPrep.members.some((m) => m.slug === 'bob'))

      wakeLog.length = 0
      const bobReply = await askTool.execute({
        roomId: grpRes.room.id,
        threadId: rotRes.threadId,
        targetSlug: 'bob',
        question: 'Please confirm DB migrations (even if mentioning @charlie in prose, do NOT wake charlie)',
        timeoutSeconds: 5,
      })
      assert.equal(bobReply.ok, true)
      assert.equal(bobReply.repliedBy, 'bob')
      assert.equal(bobReply.threadId, rotRes.threadId)
      assert.deepEqual(wakeLog.map((w) => w.node), ['bob'])

      // Live preparing/responding indicator propagation & anti-spoof check
      alice.setAgentActivity({
        roomId: grpRes.room.id,
        slug: 'alice',
        ownerName: 'Alice',
        stage: 'coordinating',
        isModerator: true,
        broadcast: true,
      })
      assert.equal(alice.getStateSnapshot().activeStatuses[grpRes.room.id]?.[0]?.stage, 'coordinating')
      await new Promise((r) => setTimeout(r, 40))
      assert.equal(
        bob.getStateSnapshot().activeStatuses[grpRes.room.id]?.[0]?.slug,
        'alice',
        'Remote peer should receive live Moderator activity over HMAC /mesh/status',
      )
      alice.clearAgentActivity({ roomId: grpRes.room.id, slug: 'alice', broadcast: true })
      await new Promise((r) => setTimeout(r, 40))
      assert.equal(alice.getStateSnapshot().activeStatuses[grpRes.room.id], undefined)
      assert.equal(bob.getStateSnapshot().activeStatuses[grpRes.room.id], undefined)

      // Spoof attempt on /mesh/status (claiming wrong slug) must be rejected with 403
      const { buildSignedHeaders } = await import('../src/host/crypto.js')
      const spoofPayload = JSON.stringify({ roomId: grpRes.room.id, slug: 'charlie', stage: 'answering' })
      const spoofRes = await alice.handleIncomingMeshHttp(
        'POST',
        '/mesh/status',
        buildSignedHeaders({
          method: 'POST',
          path: '/mesh/status',
          body: spoofPayload,
          secret: alice.store.getRoom(grpRes.room.id).groupSecret,
          fromSlug: 'bob',
          groupId: grpRes.room.id,
        }),
        spoofPayload,
      )
      assert.equal(spoofRes.status, 403)

      await aliceCtx.fiber.dispose()
    }

    // 11. End-to-End Group Multi-Sandbox Configuration Dispatch (Moderator LLM decides & delegates to all members)
    {
      const { wireHarnessRuntime } = await import('../src/host/harness-bridge.js')
      const nodeFollowups = { alice: [], bob: [], charlie: [] }
      const nodeTools = {}
      const wakeCounts = { alice: 0, bob: 0, charlie: 0 }

      async function mountMockNodeRuntime(slug, nodeSvc, onRun) {
        const nodeCtx = new Context()
        const toolsMap = new Map()
        const events = []
        let created = false

        nodeCtx.provide('tools', {
          register(toolDef) {
            toolsMap.set(toolDef.name, toolDef)
            return () => { toolsMap.delete(toolDef.name) }
          },
        })
        nodeCtx.provide('agents', { withoutInitiator: (fn) => fn() })
        nodeCtx.provide('sessions', { flush: async () => true })
        nodeCtx.provide('sessionController', {
          async create() { created = true },
          async resolveAgent() {
            if (!created) return { error: new Error('not created') }
            return {
              agent: {
                id: `session-mesh-${slug}`,
                session: {
                  id: `session-mesh-${slug}`,
                  snapshotEvents: () => [...events],
                },
                followup(userMsg) {
                  wakeCounts[slug] += 1
                  nodeFollowups[slug].push(userMsg)
                  const promptText = userMsg?.content?.[0]?.text || ''
                  const runPromise = Promise.resolve(onRun({ promptText, toolsMap, events })).then((replyText) => {
                    events.push({
                      seq: events.length + 1,
                      type: 'assistant/message',
                      data: { message: { content: [{ type: 'text', text: replyText }] } },
                    })
                    events.push({
                      seq: events.length + 1,
                      type: 'turn/end',
                      data: { turn: events.length, reason: { kind: 'completed' } },
                    })
                  })
                  this._pending = runPromise
                },
                async whenIdle() {
                  await this._pending
                },
              },
            }
          },
        })

        wireHarnessRuntime(nodeCtx, nodeSvc)
        await new Promise((r) => setTimeout(r, 30))
        nodeTools[slug] = toolsMap
        return nodeCtx
      }

      const grpRoomId = alice.store.getSnapshot().rooms.find((r) => r.type === 'group')?.id
      assert.ok(grpRoomId, 'Expected created group room for dispatch test')
      const aliceModCtx = await mountMockNodeRuntime('alice', alice, async ({ promptText, toolsMap }) => {
        assert.ok(promptText.includes('MODERATOR ROLE'))
        assert.ok(promptText.includes('needs actions/config/checks executed inside another sandbox container'))
        // At start of Moderator duty, neither bob nor charlie has been woken yet
        assert.equal(wakeCounts.bob, 0)
        assert.equal(wakeCounts.charlie, 0)

        // Moderator executes configuration locally on alice
        writeFileSync(join(aliceDir, '.sandbox-mesh-probe.conf'), 'ROLE=moderator\nSANDBOX=alice\n', 'utf8')

        // Moderator autonomously chooses to call bob and charlie sequentially via mesh_ask_peer
        const askTool = toolsMap.get('mesh_ask_peer')
        const tid = alice.store.getRoom(grpRoomId).activeThreadId
        const bobRes = await askTool.execute({
          roomId: grpRoomId,
          threadId: tid,
          targetSlug: 'bob',
          question: 'Configure .sandbox-mesh-probe.conf in your sandbox with SANDBOX=bob and report verification.',
          timeoutSeconds: 5,
        })
        assert.equal(bobRes.ok, true)
        assert.equal(bobRes.repliedBy, 'bob')
        assert.ok(!String(bobRes.reply || '').includes('Agent Error'), `Unexpected bob error: ${bobRes.reply}`)

        const charlieRes = await askTool.execute({
          roomId: grpRoomId,
          threadId: tid,
          targetSlug: 'charlie',
          question: 'Configure .sandbox-mesh-probe.conf in your sandbox with SANDBOX=charlie and report verification.',
          timeoutSeconds: 5,
        })
        assert.equal(charlieRes.ok, true)
        assert.equal(charlieRes.repliedBy, 'charlie')
        assert.ok(!String(charlieRes.reply || '').includes('Agent Error'), `Unexpected charlie error: ${charlieRes.reply}`)

        return `All 3 sandboxes configured: alice (OK), bob (${bobRes.reply}), charlie (${charlieRes.reply}).`
      })

      const bobPeerCtx = await mountMockNodeRuntime('bob', bob, async ({ promptText }) => {
        assert.ok(promptText.includes('CALLED BY GROUP MODERATOR:'))
        assert.equal(alice.getStateSnapshot().activeStatuses[grpRoomId]?.some((s) => s.stage === 'waiting_peer' && s.detail === 'bob'), true)
        writeFileSync(join(bobDir, '.sandbox-mesh-probe.conf'), 'ROLE=member\nSANDBOX=bob\n', 'utf8')
        return 'bob configured .sandbox-mesh-probe.conf cleanly'
      })

      const charliePeerCtx = await mountMockNodeRuntime('charlie', charlie, async ({ promptText }) => {
        assert.ok(promptText.includes('CALLED BY GROUP MODERATOR:'))
        writeFileSync(join(charlieDir, '.sandbox-mesh-probe.conf'), 'ROLE=member\nSANDBOX=charlie\n', 'utf8')
        return 'charlie configured .sandbox-mesh-probe.conf cleanly'
      })

      const cfgTopic = await alice.startNewTopic({ roomId: grpRoomId })
      assert.equal(cfgTopic.ok, true)

      await alice.sendMessage({
        roomId: grpRoomId,
        text: 'Please configure .sandbox-mesh-probe.conf on every sandbox (including moderator) and verify',
        actor: 'human',
      })

      // Wait until Moderator finishes orchestrating both peers and posts summary
      const waitEnd = Date.now() + 3000
      let finalSummary = null
      while (Date.now() < waitEnd) {
        const msgs = charlie.store.getSnapshot().messages[grpRoomId] || []
        finalSummary = msgs.find(
          (m) => m.threadId === cfgTopic.threadId && m.sender?.slug === 'alice' && m.sender?.actor === 'agent' && m.phase !== 'turn',
        )
        if (finalSummary && !alice.getStateSnapshot().activeStatuses[grpRoomId]) break
        await new Promise((r) => setTimeout(r, 25))
      }

      assert.ok(finalSummary, 'Expected Moderator summary message to be delivered to all group members')
      assert.ok(finalSummary.text.includes('All 3 sandboxes configured'))
      assert.equal(wakeCounts.alice, 1)
      assert.equal(wakeCounts.bob, 1)
      assert.equal(wakeCounts.charlie, 1)

      assert.ok(readFileSync(join(aliceDir, '.sandbox-mesh-probe.conf'), 'utf8').includes('SANDBOX=alice'))
      assert.ok(readFileSync(join(bobDir, '.sandbox-mesh-probe.conf'), 'utf8').includes('SANDBOX=bob'))
      assert.ok(readFileSync(join(charlieDir, '.sandbox-mesh-probe.conf'), 'utf8').includes('SANDBOX=charlie'))
      assert.ok(bob.store.getRoomAgentSessionId(grpRoomId, cfgTopic.threadId))
      assert.ok(charlie.store.getRoomAgentSessionId(grpRoomId, cfgTopic.threadId))
      assert.equal(alice.getStateSnapshot().activeStatuses[grpRoomId], undefined)

      await aliceModCtx.fiber.dispose()
      await bobPeerCtx.fiber.dispose()
      await charliePeerCtx.fiber.dispose()
    }

    // 12. Peer Ping, Group Leave & Browser-Origin Loopback Upgrade
    {
      const pingOnline = await alice.pingPeer({ slug: 'bob' })
      assert.equal(pingOnline.ok, true)
      assert.equal(pingOnline.reachable, true)
      assert.equal(pingOnline.status, 'online')
      assert.equal(typeof alice.store.getSnapshot().peers.find((p) => p.slug === 'bob')?.lastLatencyMs, 'number')

      // Group rename syncs across peers and rejects unauthorized members
      const coreGrp = alice.store.getSnapshot().rooms.find((r) => r.name === 'Core Platform Group')
      assert.ok(coreGrp)
      const unauthRename = await charlie.renameGroup({ roomId: coreGrp.id, name: 'Hacked' })
      assert.equal(unauthRename.ok, false)
      const renameRes = await alice.renameGroup({ roomId: coreGrp.id, name: 'Platform Sync Hub' })
      assert.equal(renameRes.ok, true)
      assert.equal(bob.store.getRoom(coreGrp.id).name, 'Platform Sync Hub')

      // Browser file upload + secure inline preview/download (HTML forced to text/plain inline!)
      const uploadHtml = await alice.uploadAndSendFile({
        roomId: 'pair:alice:bob',
        fileName: 'report.html',
        contentBase64: Buffer.from('<h1>Hi</h1><script>alert(1)</script>', 'utf8').toString('base64'),
        text: 'Uploaded HTML report',
      })
      assert.equal(uploadHtml.ok, true)
      const bobReceivedHtml = bob.store.getSnapshot().messages['pair:alice:bob']
        .find((m) => m.id === uploadHtml.message.id)
      assert.ok(bobReceivedHtml?.attachment?.savedPath)
      const previewInfo = await bob.readAttachmentFile({ roomId: 'pair:alice:bob', msgId: bobReceivedHtml.id })
      assert.equal(previewInfo.ok, true)
      assert.equal(previewInfo.kind, 'text')
      assert.equal(previewInfo.inlineMimeType, 'text/plain; charset=utf-8', 'HTML inline preview must force text/plain')
      const missingAtt = await bob.readAttachmentFile({ roomId: 'pair:alice:bob', msgId: 'nonexistent' })
      assert.equal(missingAtt.ok, false)
      assert.equal(missingAtt.status, 404)

      // Clock-skew resilience: remote reply stamped 60s in the past must STILL satisfy mesh_ask_peer!
      {
        const skewCtx = new Context()
        const skewTools = new Map()
        skewCtx.provide('tools', {
          register(def) {
            skewTools.set(def.name, def)
            return () => { skewTools.delete(def.name) }
          },
        })
        const { wireHarnessRuntime } = await import('../src/host/harness-bridge.js')
        wireHarnessRuntime(skewCtx, alice)
        await new Promise((r) => setTimeout(r, 20))

        // Verify mesh_list_peers renders human-readable text rather than raw JSON
        const listTool = skewTools.get('mesh_list_peers')
        const listVal = await listTool.execute({})
        const renderedList = listTool.output.render({}, listVal)[0]?.text || ''
        assert.ok(renderedList.includes('Connected Sandboxes'), 'mesh_list_peers render should be readable text')
        assert.ok(!renderedList.trim().startsWith('{'), 'mesh_list_peers render must not dump raw JSON')

        bob.setAgentWakeHandler(({ room, message }) => {
          // Simulate Bob's container clock running 60 seconds behind Alice
          const skewedMsg = {
            id: `msg_skew_${Date.now()}`,
            roomId: room.id,
            threadId: message.threadId,
            sender: { slug: 'bob', ownerName: 'Bob', actor: 'agent' },
            kind: 'chat',
            text: 'Skewed-clock reply received cleanly!',
            createdAt: Date.now() - 60_000,
          }
          alice.store.recordMessage(skewedMsg, { isIncoming: true })
        })

        const askTool = skewTools.get('mesh_ask_peer')
        const skewReply = await askTool.execute({
          targetSlug: 'bob',
          roomId: 'pair:alice:bob',
          question: 'Test clock skew handling',
          timeoutSeconds: 5,
        })
        assert.equal(skewReply.ok, true, 'mesh_ask_peer must not time out when peer clock lags behind')
        assert.equal(skewReply.reply, 'Skewed-clock reply received cleanly!')

        // Auto-creating task groups from conversation: derived groupName, aligned initial threadId, opening task brief, smart reuse & unpaired validation
        const { deriveTaskGroupName } = await import('../src/host/harness-bridge.js')
        assert.equal(deriveTaskGroupName('', '请帮我联调登录鉴权接口。检查 OIDC 回调'), '联调登录鉴权接口')
        assert.equal(deriveTaskGroupName('Custom Name', 'anything'), 'Custom Name')

        const discussTool = skewTools.get('mesh_discuss_group')
        const prematureWakes = []
        bob.setAgentWakeHandler(({ message }) => { prematureWakes.push(message.id) })
        charlie.setAgentWakeHandler(({ message }) => { prematureWakes.push(message.id) })

        // Unpaired-only memberSlugs must fail cleanly instead of creating an empty 1-node group
        const badMembers = await discussTool.execute({
          topic: 'Check unknown peer',
          memberSlugs: ['ghost-node'],
        })
        assert.equal(badMembers.ok, false)

        // Auto-create task group without roomId or groupName -> derives name, aligns threadId, posts brief without waking peers
        const autoGrp = await discussTool.execute({
          topic: '请帮我联调登录鉴权接口。检查 OIDC 回调与 session 续期',
          memberSlugs: ['bob', 'charlie'],
        })
        assert.equal(autoGrp.ok, true)
        assert.equal(autoGrp.createdNewGroup, true)
        assert.equal(autoGrp.reusedGroup, false)
        assert.equal(autoGrp.groupName, '联调登录鉴权接口')
        assert.equal(autoGrp.threadId, alice.store.getRoom(autoGrp.roomId).activeThreadId, 'New group must reuse initial activeThreadId')
        const autoMsgs = alice.store.getSnapshot().messages[autoGrp.roomId] || []
        assert.ok(autoMsgs.some((m) => m.kind === 'chat' && m.text.includes('检查 OIDC 回调与 session 续期')), 'Opening task brief must be posted to group')
        await new Promise((r) => setTimeout(r, 30))
        assert.equal(prematureWakes.length, 0, 'Opening task brief must not wake peer agents prematurely')

        // Re-running with same task name reuses the group and rotates to a clean fresh topic thread
        const reusedGrp = await discussTool.execute({
          topic: '二期补充检查：验证登出逻辑',
          groupName: '联调登录鉴权接口',
          memberSlugs: ['bob', 'charlie'],
        })
        assert.equal(reusedGrp.ok, true)
        assert.equal(reusedGrp.createdNewGroup, false)
        assert.equal(reusedGrp.reusedGroup, true)
        assert.equal(reusedGrp.roomId, autoGrp.roomId)
        assert.notEqual(reusedGrp.threadId, autoGrp.threadId)

        // Explicit reuseExisting: false forces a brand-new separate task group
        const forcedNew = await discussTool.execute({
          topic: '独立复盘',
          groupName: '联调登录鉴权接口',
          memberSlugs: ['bob', 'charlie'],
          reuseExisting: false,
        })
        assert.equal(forcedNew.ok, true)
        assert.equal(forcedNew.createdNewGroup, true)
        assert.notEqual(forcedNew.roomId, autoGrp.roomId)

        // Node with zero paired sandboxes must refuse to create an empty 1-node group
        const { svc: solo } = createSandboxNode('solo', 'Solo')
        const soloCtx = new Context()
        const soloTools = new Map()
        soloCtx.provide('tools', {
          register(def) {
            soloTools.set(def.name, def)
            return () => { soloTools.delete(def.name) }
          },
        })
        wireHarnessRuntime(soloCtx, solo)
        await new Promise((r) => setTimeout(r, 20))
        const soloRes = await soloTools.get('mesh_discuss_group').execute({ topic: 'Do solo task' })
        assert.equal(soloRes.ok, false)
        await soloCtx.fiber.dispose()

        await skewCtx.fiber.dispose()
      }

      // Charlie leaves Platform Sync Hub -> Alice (creator) rotates groupSecret & removes Charlie
      const oldSec = alice.store.getRoom(coreGrp.id).groupSecret
      const leaveRes = await charlie.leaveGroup({ roomId: coreGrp.id })
      assert.equal(leaveRes.ok, true)
      assert.equal(charlie.store.getRoom(coreGrp.id), null)
      assert.equal(alice.store.getRoom(coreGrp.id).members.some((m) => m.slug === 'charlie'), false)
      assert.notEqual(alice.store.getRoom(coreGrp.id).groupSecret, oldSec)

      // Loopback SANDBOX_PUBLIC_ORIGIN upgrades cleanly from forwarded Host/Origin header and persists across headerless updates
      const { createMeshStore } = await import('../src/host/store.js')
      const lanStore = createMeshStore({
        filePath: join(tempDir, 'lan-store.json'),
        config: { slug: 'lan1' },
        env: { SANDBOX_PUBLIC_ORIGIN: 'http://localhost:9000' },
      })
      lanStore.updateSelf({ origin: 'http://192.168.1.50:9000' })
      assert.equal(lanStore.getSelf().endpointUrl, 'http://192.168.1.50:9000/s/lan1/p/4090')
      lanStore.updateSelf(null, 4090)
      assert.equal(lanStore.getSelf().endpointUrl, 'http://192.168.1.50:9000/s/lan1/p/4090')
    }

    // 13. Incremental Context Deduplication (threadCursors + DSH native session history)
    {
      const { buildAgentWakePrompt, wireHarnessRuntime } = await import('../src/host/harness-bridge.js')
      const pairRoom = bob.store.getRoom('pair:alice:bob')
      const bobSelf = bob.store.getSelf()

      // 13a. Unit tests on buildAgentWakePrompt
      const thr = 'thr_delta_unit'
      const longBody = `${'X'.repeat(2500)}__TAIL_MARKER__`
      const msgs = [
        { id: 'u1', threadId: thr, kind: 'chat', sender: { slug: 'alice', ownerName: 'Alice', actor: 'human' }, text: `Initial requirement: ${longBody}` },
        { id: 'u2', threadId: thr, kind: 'chat', sender: { slug: 'bob', ownerName: 'Bob', actor: 'agent' }, text: 'Bob Turn 1 answer' },
        { id: 'u3', threadId: thr, kind: 'chat', sender: { slug: 'alice', ownerName: 'Alice', actor: 'human' }, text: 'Unseen bystander note before wake' },
        { id: 'u4', threadId: thr, kind: 'chat', sender: { slug: 'alice', ownerName: 'Alice', actor: 'human' }, text: '@bob Follow-up question' },
        { id: 'u5', threadId: thr, kind: 'chat', sender: { slug: 'alice', ownerName: 'Alice', actor: 'human' }, text: 'Queued later message' },
      ]

      // Fresh session (no cursor): includes full prior messages losslessly (no hard truncation)
      const pFresh = buildAgentWakePrompt({
        self: bobSelf,
        room: pairRoom,
        message: msgs[3],
        recentMessages: msgs,
        lastSeenMessageId: '',
      })
      assert.ok(pFresh.includes('Current Thread Context'))
      assert.ok(pFresh.includes('<remote-mesh-context>'))
      assert.ok(pFresh.includes('Initial requirement:'))
      assert.ok(pFresh.includes('__TAIL_MARKER__'), 'Long context messages must be passed losslessly to DSH native session')
      assert.ok(!pFresh.includes('[truncated]'), 'Context messages must not be hard-truncated')
      assert.ok(!pFresh.includes('Queued later message'), 'Messages after current message must never appear in context')

      // Resumed session with NO unseen external messages (only self agent reply between u1 and u3-as-current)
      const pNoDelta = buildAgentWakePrompt({
        self: bobSelf,
        room: pairRoom,
        message: msgs[2],
        recentMessages: msgs,
        lastSeenMessageId: 'u1',
      })
      assert.ok(!pNoDelta.includes('<remote-mesh-context>'), 'Context block must be omitted when DSH session is already up to date')
      assert.ok(!pNoDelta.includes('Bob Turn 1 answer'), 'Own prior agent reply must not be re-injected')
      assert.ok(pNoDelta.includes('Unseen bystander note before wake'))

      // Resumed session WITH unseen bystander message (u3) after cursor u1
      const pWithDelta = buildAgentWakePrompt({
        self: bobSelf,
        room: pairRoom,
        message: msgs[3],
        recentMessages: msgs,
        lastSeenMessageId: 'u1',
      })
      assert.ok(pWithDelta.includes('Unseen Room Messages Since Your Last Turn'))
      assert.ok(pWithDelta.includes('Unseen bystander note before wake'))
      assert.ok(!pWithDelta.includes('Initial requirement:'), 'Already-seen messages at/before cursor must not repeat')
      assert.ok(!pWithDelta.includes('Bob Turn 1 answer'), 'Own prior agent reply must not repeat in delta')
      assert.ok(!pWithDelta.includes('Queued later message'), 'Queued later messages must not leak into current turn context')

      // Stale/pruned cursor (not in recentMessages): falls back cleanly to recent thread context
      const pStaleCursor = buildAgentWakePrompt({
        self: bobSelf,
        room: pairRoom,
        message: msgs[3],
        recentMessages: msgs,
        lastSeenMessageId: 'msg_pruned_old',
      })
      assert.ok(pStaleCursor.includes('Current Thread Context'))
      assert.ok(pStaleCursor.includes('Initial requirement:'))

      // 13b. End-to-end multi-turn harness lifecycle: reuse session (zero dup), unseen delta, and session-recreation fallback
      const deltaTopic = await alice.startNewTopic({ roomId: 'pair:alice:bob' })
      assert.equal(deltaTopic.ok, true)
      const deltaTid = deltaTopic.threadId

      const deltaCtx = new Context()
      const deltaPrompts = []
      const deltaEvents = []
      let sessionAlive = false
      let sessionCreateCount = 0

      deltaCtx.provide('agents', { withoutInitiator: (fn) => fn() })
      deltaCtx.provide('sessions', { flush: async () => true })
      deltaCtx.provide('sessionController', {
        async create() {
          sessionCreateCount += 1
          sessionAlive = true
        },
        async resolveAgent() {
          if (!sessionAlive) return { error: new Error('session missing') }
          return {
            agent: {
              id: `session-delta-${sessionCreateCount}`,
              session: {
                id: `session-delta-${sessionCreateCount}`,
                snapshotEvents: () => [...deltaEvents],
              },
              followup(userMsg) {
                deltaPrompts.push(userMsg?.content?.[0]?.text || '')
                deltaEvents.push({
                  seq: deltaEvents.length + 1,
                  type: 'assistant/message',
                  data: { message: { content: [{ type: 'text', text: `Bob reply #${deltaPrompts.length}` }] } },
                })
                deltaEvents.push({
                  seq: deltaEvents.length + 1,
                  type: 'turn/end',
                  data: { turn: deltaPrompts.length, reason: { kind: 'completed' } },
                })
              },
              whenIdle: async () => {},
            },
          }
        },
      })

      wireHarnessRuntime(deltaCtx, bob)
      await new Promise((r) => setTimeout(r, 30))

      const waitPrompts = async (expectedCount) => {
        const deadline = Date.now() + 2000
        while (Date.now() < deadline && deltaPrompts.length < expectedCount) {
          await new Promise((r) => setTimeout(r, 20))
        }
        // Let post-idle cursor update & auto-reply finish
        await new Promise((r) => setTimeout(r, 40))
      }

      // Turn 1: fresh session created -> cursor advances to t1.message.id
      const t1 = await alice.sendMessage({
        roomId: 'pair:alice:bob',
        threadId: deltaTid,
        text: '@bob Turn1 unique payload alpha',
        actor: 'human',
      })
      await waitPrompts(1)
      assert.equal(sessionCreateCount, 1)
      assert.equal(deltaPrompts.length, 1)
      assert.ok(deltaPrompts[0].includes('Current Thread Context'))
      assert.equal(bob.store.getRoomThreadCursor('pair:alice:bob', deltaTid), t1.message.id)

      // Turn 2: same thread, no unseen messages -> reuses session & completely omits <remote-mesh-context>
      const t2 = await alice.sendMessage({
        roomId: 'pair:alice:bob',
        threadId: deltaTid,
        text: '@bob Turn2 follow-up beta',
        actor: 'human',
      })
      await waitPrompts(2)
      assert.equal(sessionCreateCount, 1, 'Turn 2 must reuse existing DSH session')
      assert.equal(deltaPrompts.length, 2)
      assert.ok(!deltaPrompts[1].includes('<remote-mesh-context>'), 'Turn 2 must omit <remote-mesh-context> when no unseen messages exist')
      assert.ok(!deltaPrompts[1].includes('Turn1 unique payload alpha'), 'Turn 2 must not re-inject Turn 1 text')
      assert.ok(!deltaPrompts[1].includes('Bob reply #1'), 'Turn 2 must not re-inject own Turn 1 reply')
      assert.equal(bob.store.getRoomThreadCursor('pair:alice:bob', deltaTid), t2.message.id)

      // Turn 3: inject a non-waking bystander message on Bob's room, then send Turn 3 wake -> ONLY bystander message appears in delta
      bob.store.recordMessage({
        id: 'msg_bystander_delta',
        roomId: 'pair:alice:bob',
        threadId: deltaTid,
        sender: { slug: 'alice', ownerName: 'Alice', actor: 'human' },
        kind: 'chat',
        mentions: [],
        text: 'Side note gamma without waking Bob',
        hop: 0,
      }, { isIncoming: true })
      const t3 = await alice.sendMessage({
        roomId: 'pair:alice:bob',
        threadId: deltaTid,
        text: '@bob Turn3 check gamma',
        actor: 'human',
      })
      await waitPrompts(3)
      assert.equal(deltaPrompts.length, 3)
      assert.ok(deltaPrompts[2].includes('Unseen Room Messages Since Your Last Turn'))
      assert.ok(deltaPrompts[2].includes('Side note gamma without waking Bob'))
      assert.ok(!deltaPrompts[2].includes('Turn1 unique payload alpha'))
      assert.ok(!deltaPrompts[2].includes('Turn2 follow-up beta'))
      assert.equal(bob.store.getRoomThreadCursor('pair:alice:bob', deltaTid), t3.message.id)

      // Turn 4: simulate DSH session deleted/lost -> sessionController.create runs -> restores recent thread context cleanly
      sessionAlive = false
      const t4 = await alice.sendMessage({
        roomId: 'pair:alice:bob',
        threadId: deltaTid,
        text: '@bob Turn4 after session reset',
        actor: 'human',
      })
      await waitPrompts(4)
      assert.equal(sessionCreateCount, 2, 'Expected DSH session to be recreated after loss')
      assert.equal(deltaPrompts.length, 4)
      assert.ok(deltaPrompts[3].includes('Current Thread Context'), 'Recreated session must restore full recent thread context')
      assert.ok(deltaPrompts[3].includes('Turn1 unique payload alpha'))
      assert.ok(deltaPrompts[3].includes('Turn3 check gamma'))
      assert.equal(bob.store.getRoomThreadCursor('pair:alice:bob', deltaTid), t4.message.id)

      await deltaCtx.fiber.dispose()
    }

    // 14. Shared Task Board, Parallel Fan-Out Dispatch, Dependency DAG, Local Role SOP & Human Approval Gates
    {
      const { buildAgentWakePrompt, wireHarnessRuntime } = await import('../src/host/harness-bridge.js')

      // 14a. Local-only Role SOP (`instructions`) stays strictly private to local wake prompt (never leaked over /mesh/profile-sync)
      await bob.updateProfile({
        role: 'Backend Lead',
        description: 'Owns API & DB',
        instructions: 'PRIVATE_LOCAL_SOP_USE_GIT_MCP_BEFORE_MERGE',
      })
      assert.equal(bob.store.getSelf().instructions, 'PRIVATE_LOCAL_SOP_USE_GIT_MCP_BEFORE_MERGE')
      assert.equal(alice.store.getPeer('bob').instructions, undefined, 'Local Role SOP must never leak to remote peers')

      // 14b. Create 3-sandbox project group (Alice Moderator, Bob Backend, Charlie QA)
      const projGrp = await alice.createGroup({
        name: 'Release v2 Launch',
        memberSlugs: ['bob', 'charlie'],
        moderatorSlug: 'alice',
      })
      assert.equal(projGrp.ok, true)
      const projRoomId = projGrp.room.id
      const projThreadId = projGrp.room.activeThreadId

      const aliceCtx = new Context()
      const aliceTools = new Map()
      aliceCtx.provide('tools', {
        register(def) {
          aliceTools.set(def.name, def)
          return () => { aliceTools.delete(def.name) }
        },
      })
      const bobCtx = new Context()
      const bobTools = new Map()
      bobCtx.provide('tools', {
        register(def) {
          bobTools.set(def.name, def)
          return () => { bobTools.delete(def.name) }
        },
      })
      wireHarnessRuntime(aliceCtx, alice)
      wireHarnessRuntime(bobCtx, bob)
      await new Promise((r) => setTimeout(r, 30))

      const dispatchTool = aliceTools.get('mesh_dispatch_tasks')
      const boardTool = aliceTools.get('mesh_task_board')
      const aliceUpdateTool = aliceTools.get('mesh_task_update')
      const approvalTool = aliceTools.get('mesh_request_approval')
      const bobUpdateTool = bobTools.get('mesh_task_update')
      assert.ok(dispatchTool && boardTool && aliceUpdateTool && approvalTool && bobUpdateTool)

      const wokeNodes = []
      alice.setAgentWakeHandler(({ message }) => { wokeNodes.push({ node: 'alice', taskId: message.taskId, text: message.text }) })
      bob.setAgentWakeHandler(({ message }) => { wokeNodes.push({ node: 'bob', taskId: message.taskId, text: message.text }) })
      charlie.setAgentWakeHandler(({ message }) => { wokeNodes.push({ node: 'charlie', taskId: message.taskId, text: message.text }) })

      // 14c. Async fan-out with staged DAG dependencies: Task 0 (@bob) runnable, Task 1 (@alice) local, Task 2 (@charlie) depends on Task 0
      const asyncDisp = await dispatchTool.execute({
        roomId: projRoomId,
        threadId: projThreadId,
        mode: 'async',
        tasks: [
          { title: 'Build OAuth API', description: 'Add /auth/callback endpoint', assigneeSlug: 'bob', priority: 'high' },
          { title: 'Review API Spec', assigneeSlug: 'alice', priority: 'medium' },
          { title: 'Run E2E QA', description: 'Verify OAuth flow end-to-end', assigneeSlug: 'charlie', priority: 'high', dependsOnIndices: [0] },
        ],
      })
      assert.equal(asyncDisp.ok, true)
      assert.equal(asyncDisp.mode, 'async')
      assert.equal(asyncDisp.tasks.length, 3)
      const [tBe, , tQa] = asyncDisp.tasks
      assert.deepEqual(tQa.dependsOn, [tBe.id], 'dependsOnIndices must resolve to created task IDs')
      assert.ok(asyncDisp.dispatchedIds.includes(tBe.id))
      assert.ok(asyncDisp.blockedByDependencyIds.includes(tQa.id), 'Dependent QA task must stay blocked until BE task completes')

      // Verify task board replicated over HMAC /mesh/task-sync to Bob and Charlie
      assert.equal(bob.store.listRoomTasks(projRoomId).length, 3)
      assert.equal(charlie.store.listRoomTasks(projRoomId).length, 3)
      await new Promise((r) => setTimeout(r, 30))
      assert.equal(wokeNodes.some((w) => w.node === 'bob' && w.taskId === tBe.id), true, 'Bob must be woken immediately for runnable task')
      assert.equal(wokeNodes.some((w) => w.node === 'charlie'), false, 'Charlie must NOT be woken while dependency is unfinished')

      // Verify buildAgentWakePrompt injects both local Role SOP AND live <room-task-board>
      const bobPromptWithBoard = buildAgentWakePrompt({
        self: bob.store.getSelf(),
        room: bob.store.getRoom(projRoomId),
        message: { id: 'm_board_probe', threadId: projThreadId, taskId: tBe.id, sender: { slug: 'alice', ownerName: 'Alice', actor: 'agent' }, text: 'Start BE' },
        recentMessages: [],
        roomTasks: bob.store.listRoomTasks(projRoomId, { threadId: projThreadId }),
      })
      assert.ok(bobPromptWithBoard.includes('PRIVATE_LOCAL_SOP_USE_GIT_MCP_BEFORE_MERGE'))
      assert.ok(bobPromptWithBoard.includes('<room-task-board>'))
      assert.ok(bobPromptWithBoard.includes('Build OAuth API'))
      assert.ok(bobPromptWithBoard.includes('Run E2E QA'))

      // Bob finishes Task 0 via mesh_task_update -> syncs artifacts across all nodes, unlocks Task 2, and notifies Moderator Alice
      wokeNodes.length = 0
      const bobDone = await bobUpdateTool.execute({
        roomId: projRoomId,
        taskId: tBe.id,
        status: 'done',
        summary: 'Implemented /auth/callback and passed 18 unit tests',
        artifacts: ['branch:feat/oauth', 'https://preview.local/auth'],
      })
      assert.equal(bobDone.ok, true)
      assert.equal(bobDone.task.status, 'done')
      assert.deepEqual(bobDone.task.artifacts, ['branch:feat/oauth', 'https://preview.local/auth'])
      assert.ok(bobDone.unblockedDependents.some((d) => d.id === tQa.id), 'Completing BE task must report QA task as unblocked')
      assert.equal(alice.store.getTask(projRoomId, tBe.id).status, 'done')
      assert.deepEqual(charlie.store.getTask(projRoomId, tBe.id).artifacts, ['branch:feat/oauth', 'https://preview.local/auth'])
      await new Promise((r) => setTimeout(r, 30))
      assert.equal(wokeNodes.some((w) => w.node === 'alice' && w.text.includes('DONE')), true, 'Moderator Alice must be notified when Bob completes task')
      assert.equal(wokeNodes.some((w) => w.node === 'charlie' && w.taskId === tQa.id && w.text.includes('UNBLOCKED')), true, 'Completing upstream DAG task must automatically wake newly unblocked downstream assignee Charlie')

      // mesh_task_board summarizes progress accurately
      const boardSnap = await boardTool.execute({ roomId: projRoomId, threadId: projThreadId })
      assert.equal(boardSnap.ok, true)
      assert.equal(boardSnap.summary.total, 3)
      assert.equal(boardSnap.summary.done, 1)
      assert.equal(boardSnap.tasks.find((t) => t.id === tQa.id)?.dependenciesMet, true)

      // 14d. Parallel `mode: 'wait'` fan-out across Bob & Charlie concurrently
      bob.setAgentWakeHandler(({ room, message }) => {
        setTimeout(() => {
          void bob.updateTask({
            roomId: room.id,
            taskId: message.taskId,
            status: 'done',
            summary: 'Backend review approved',
            artifacts: ['doc:be-review.md'],
            actor: 'agent',
            notifyModerator: false,
          })
        }, 25)
      })
      charlie.setAgentWakeHandler(({ room, message }) => {
        setTimeout(() => {
          void charlie.updateTask({
            roomId: room.id,
            taskId: message.taskId,
            status: 'done',
            summary: 'QA test plan ready',
            artifacts: ['doc:qa-plan.md'],
            actor: 'agent',
            notifyModerator: false,
          })
        }, 25)
      })
      const waitDisp = await dispatchTool.execute({
        roomId: projRoomId,
        threadId: projThreadId,
        mode: 'wait',
        timeoutSeconds: 5,
        tasks: [
          { title: 'Backend Arch Review', assigneeSlug: 'bob' },
          { title: 'QA Plan Review', assigneeSlug: 'charlie' },
        ],
      })
      assert.equal(waitDisp.ok, true)
      assert.equal(waitDisp.mode, 'wait')
      assert.equal(waitDisp.results.length, 2)
      assert.equal(waitDisp.results.every((r) => r.ok && r.status === 'done'), true)
      assert.ok(waitDisp.results.some((r) => r.assigneeSlug === 'bob' && r.reply.includes('Backend review approved')))
      assert.ok(waitDisp.results.some((r) => r.assigneeSlug === 'charlie' && r.reply.includes('QA test plan ready')))

      // 14e. Human Approval Gate: Agent request -> self-approval blocked -> human approve auto-wakes assignee -> human reject moves back to in_progress
      wokeNodes.length = 0
      bob.setAgentWakeHandler(({ message }) => { wokeNodes.push({ node: 'bob', taskId: message.taskId, text: message.text }) })
      const apprReq = await approvalTool.execute({
        roomId: projRoomId,
        threadId: projThreadId,
        title: 'Approve Production Release v2.0',
        prompt: 'All 18 unit tests and E2E checks passed. Approve deploy to production?',
        assigneeSlug: 'bob',
      })
      assert.equal(apprReq.ok, true)
      assert.equal(apprReq.task.approvalRequired, true)
      assert.equal(apprReq.task.approvalStatus, 'pending')
      const gateTaskId = apprReq.task.id
      assert.equal(bob.store.getTask(projRoomId, gateTaskId)?.approvalStatus, 'pending')
      await new Promise((r) => setTimeout(r, 30))
      assert.equal(wokeNodes.length, 0, 'Posting an approval gate must NOT wake agents prematurely')

      // Security check: Agent MUST NOT be allowed to self-approve a human approval gate
      const selfApproveAttempt = await bobUpdateTool.execute({
        roomId: projRoomId,
        taskId: gateTaskId,
        approvalStatus: 'approved',
      })
      assert.equal(selfApproveAttempt.ok, false)
      assert.match(selfApproveAttempt.error, /Only human approval/i)
      assert.equal(bob.store.getTask(projRoomId, gateTaskId)?.approvalStatus, 'pending')

      // Security check: Unauthorized / forged /mesh/task-sync is rejected with 401
      const forgedTaskSync = await alice.handleIncomingMeshHttp(
        'POST',
        '/mesh/task-sync',
        { 'content-type': 'application/json' },
        JSON.stringify({ roomId: projRoomId, tasks: [{ id: gateTaskId, title: 'Hacked', approvalStatus: 'approved', version: 99 }] }),
      )
      assert.equal(forgedTaskSync.status, 401)

      // Human clicks Approve -> task updates, syncs to Bob & Charlie, and automatically wakes Bob!
      const approvedRes = await alice.decideApproval({
        roomId: projRoomId,
        taskId: gateTaskId,
        decision: 'approved',
        comment: 'Looks solid, proceed with rollout',
      })
      assert.equal(approvedRes.ok, true)
      assert.equal(approvedRes.task.approvalStatus, 'approved')
      assert.equal(approvedRes.task.approvalComment, 'Looks solid, proceed with rollout')
      assert.equal(bob.store.getTask(projRoomId, gateTaskId)?.approvalStatus, 'approved')
      assert.equal(charlie.store.getTask(projRoomId, gateTaskId)?.approvalStatus, 'approved')
      await new Promise((r) => setTimeout(r, 30))
      assert.equal(
        wokeNodes.some((w) => w.node === 'bob' && w.taskId === gateTaskId && w.text.includes('APPROVED')),
        true,
        'Human approval must automatically wake assigned sandbox agent',
      )

      // Human clicks Reject on another gate -> moves status back to in_progress and wakes assignee
      const apprReq2 = await approvalTool.execute({
        roomId: projRoomId,
        threadId: projThreadId,
        title: 'Approve Schema Drop',
        prompt: 'Drop legacy_sessions table?',
        assigneeSlug: 'bob',
      })
      const rejectedRes = await alice.decideApproval({
        roomId: projRoomId,
        taskId: apprReq2.task.id,
        decision: 'rejected',
        comment: 'Archive table first before dropping',
      })
      assert.equal(rejectedRes.ok, true)
      assert.equal(rejectedRes.task.approvalStatus, 'rejected')
      assert.equal(rejectedRes.task.status, 'in_progress')

      // Regression check: /local/cli ping must return numeric HTTP 200 even though payload.status === 'online'
      const cliPingRes = await alice.handleIncomingMeshHttp(
        'POST',
        '/local/cli',
        { authorization: `Bearer ${alice.localToken}`, 'content-type': 'application/json' },
        JSON.stringify({ action: 'ping', slug: 'bob' }),
      )
      assert.equal(cliPingRes.status, 200)
      assert.equal(cliPingRes.body.ok, true)
      assert.equal(cliPingRes.body.status, 'online')

      // 14f. Unpaired Moderator <-> Member group collaboration (star topology: Alice paired with Bob & Charlie; Bob NOT paired with Charlie)
      assert.equal(bob.store.getPeer('charlie'), null, 'Bob and Charlie must NOT be directly paired')
      assert.equal(charlie.store.getPeer('bob'), null, 'Charlie and Bob must NOT be directly paired')
      const starGrp = await alice.createGroup({
        name: 'Star Topology Squad',
        memberSlugs: ['bob', 'charlie'],
        moderatorSlug: 'bob',
      })
      assert.equal(starGrp.ok, true)
      const starRoomId = starGrp.room.id
      const starThreadId = starGrp.room.activeThreadId
      assert.equal(bob.store.getRoom(starRoomId)?.moderatorSlug, 'bob')
      assert.equal(charlie.store.getRoom(starRoomId)?.moderatorSlug, 'bob')

      // Bob (unpaired Moderator) dispatches a tracked task directly to Charlie via groupSecret!
      const bobDispatchTool = bobTools.get('mesh_dispatch_tasks')
      wokeNodes.length = 0
      charlie.setAgentWakeHandler(({ message }) => { wokeNodes.push({ node: 'charlie', taskId: message.taskId }) })
      const bobDisp = await bobDispatchTool.execute({
        roomId: starRoomId,
        threadId: starThreadId,
        mode: 'async',
        tasks: [{ title: 'Charlie QA Smoke Check', assigneeSlug: 'charlie' }],
      })
      assert.equal(bobDisp.ok, true)
      const starTaskId = bobDisp.tasks[0].id
      assert.equal(charlie.store.getTask(starRoomId, starTaskId)?.title, 'Charlie QA Smoke Check')
      await new Promise((r) => setTimeout(r, 30))
      assert.equal(wokeNodes.some((w) => w.node === 'charlie' && w.taskId === starTaskId), true)

      // Charlie reports back to unpaired Moderator Bob
      const charlieReply = await charlie.updateTask({
        roomId: starRoomId,
        taskId: starTaskId,
        status: 'done',
        summary: 'Smoke checks 100% green',
        actor: 'agent',
        notifyModerator: true,
      })
      assert.equal(charlieReply.ok, true)
      assert.equal(bob.store.getTask(starRoomId, starTaskId)?.status, 'done')

      // Unpaired Moderator Bob renames the group -> synced cleanly to both Alice and Charlie, without rotating groupSecret
      const secretBeforeRename = charlie.store.getRoom(starRoomId).groupSecret
      const bobRename = await bob.renameGroup({ roomId: starRoomId, name: 'Star Squad v2' })
      assert.equal(bobRename.ok, true)
      assert.equal(alice.store.getRoom(starRoomId)?.name, 'Star Squad v2')
      assert.equal(charlie.store.getRoom(starRoomId)?.name, 'Star Squad v2')
      assert.equal(charlie.store.getRoom(starRoomId)?.groupSecret, secretBeforeRename)

      // 14g. Dedicated collab-space workspace hygiene, unarchiving previously archived session-mesh-* for Agent Log access, and collab-space relative file sharing
      {
        const collabDirPath = join(aliceDir, 'collab-space')
        const collabFile = join(collabDirPath, 'demo-note.txt')
        mkdirSync(collabDirPath, { recursive: true })
        writeFileSync(collabFile, 'hello from collab-space', 'utf8')
        const sharedCollab = await alice.sendFile({
          roomId: starRoomId,
          filePath: 'demo-note.txt',
          text: 'collab-space relative path',
          actor: 'agent',
        })
        assert.equal(sharedCollab.ok, true, 'Relative files inside collab-space/ must resolve cleanly for mesh_share_file')

        const wsHome = {
          id: 'ws_home',
          path: aliceDir,
          title: '沙箱互联 (Sandbox Mesh)',
          sessionIds: ['session-normal-1', 'session-normal-archived'],
          async setTitle(next) { this.title = next },
          async attachSession(sid) { if (!this.sessionIds.includes(sid)) this.sessionIds.push(sid) },
        }
        const wsList = [wsHome]
        // Simulate a mesh session previously auto-archived by an older version plus a user-archived normal session
        const archivedIds = ['session-mesh-legacy-1', 'session-normal-archived']
        const movedToEnd = []
        const fakeWsRegistry = {
          get archivedSessionIds() { return archivedIds },
          list() { return wsList },
          async resolveByPath(p) { return wsList.find((w) => w.path === p) || null },
          async create(p, title) {
            let found = wsList.find((w) => w.path === p)
            if (!found) {
              found = {
                id: 'ws_collab',
                path: p,
                title,
                sessionIds: [],
                async setTitle(next) { this.title = next },
                async attachSession(sid) { if (!this.sessionIds.includes(sid)) this.sessionIds.push(sid) },
              }
              wsList.unshift(found)
            }
            return found
          },
          async insertBefore(id, beforeId) {
            movedToEnd.push({ id, beforeId })
            const idx = wsList.findIndex((w) => w.id === id)
            if (idx >= 0 && beforeId === undefined) {
              const [item] = wsList.splice(idx, 1)
              wsList.push(item)
            }
          },
          async archiveSession(sid) {
            if (!archivedIds.includes(String(sid))) archivedIds.push(String(sid))
          },
          async unarchiveSession(sid) {
            const idx = archivedIds.indexOf(String(sid))
            if (idx >= 0) archivedIds.splice(idx, 1)
          },
        }
        const wsCtx = new Context()
        wsCtx.provide('agents', {})
        wsCtx.provide('sessions', {})
        wsCtx.provide('sessionController', {
          async resolveAgent() { return null },
          async create() {},
        })
        wsCtx.provide('workspaceRegistry', fakeWsRegistry)
        const { wireHarnessRuntime } = await import('../src/host/harness-bridge.js')
        wireHarnessRuntime(wsCtx, alice, { logger: console })
        await new Promise((r) => setTimeout(r, 80))
        assert.notEqual(wsHome.title, '沙箱互联 (Sandbox Mesh)', 'Legacy home workspace title must be restored')
        const collabWs = wsList.find((w) => w.path === collabDirPath)
        assert.ok(collabWs, 'Dedicated collab-space workspace must be created')
        assert.equal(collabWs.title, '协同空间')
        assert.equal(wsList[wsList.length - 1].id, 'ws_collab', 'Collab Space workspace must be placed after normal workspaces')
        assert.equal(archivedIds.includes('session-mesh-legacy-1'), false, 'Previously auto-archived session-mesh-* must be unarchived so Agent Log stays viewable')
        assert.equal(collabWs.sessionIds.includes('session-mesh-legacy-1'), true, 'Restored session-mesh-* must be attached to dedicated Collab Space workspace')
        assert.equal(archivedIds.includes('session-normal-1'), false, 'Normal active user chat sessions must NEVER be archived')
        assert.equal(archivedIds.includes('session-normal-archived'), true, 'User-archived normal chat sessions must NEVER be unarchived')
        await wsCtx.fiber.dispose()

        // Simulate user renaming the Collab Space workspace and dragging it to the top -> restart must preserve both!
        await collabWs.setTitle('我的研发团队')
        const [movedCollab] = wsList.splice(wsList.indexOf(collabWs), 1)
        wsList.unshift(movedCollab)
        const moveCountBeforeRestart = movedToEnd.length
        const wsCtx2 = new Context()
        wsCtx2.provide('agents', {})
        wsCtx2.provide('sessions', {})
        wsCtx2.provide('sessionController', {
          async resolveAgent() { return null },
          async create() {},
        })
        wsCtx2.provide('workspaceRegistry', fakeWsRegistry)
        wireHarnessRuntime(wsCtx2, alice, { logger: console })
        await new Promise((r) => setTimeout(r, 80))
        assert.equal(collabWs.title, '我的研发团队', 'User-renamed Collab Space workspace title must NEVER be overwritten')
        assert.equal(wsList[0].id, 'ws_collab', 'User custom workspace ordering must NEVER be overwritten on restart')
        assert.equal(movedToEnd.length, moveCountBeforeRestart, 'insertBefore must not be called for an already-existing workspace')
        await wsCtx2.fiber.dispose()
      }

      // 14h. Turn-End Commit Barrier (deferred handoff), strict DONE->UNBLOCKED ordering, reopen cancel, and atomic shareFiles
      {
        const orderGrp = await alice.createGroup({
          name: 'Strict Ordering Squad',
          memberSlugs: ['bob', 'charlie'],
          moderatorSlug: 'alice',
        })
        assert.equal(orderGrp.ok, true)
        const orderRoomId = orderGrp.room.id

        const dagBatch = await alice.createTasks({
          roomId: orderRoomId,
          tasks: [
            { title: 'Build Artifact', assigneeSlug: 'bob', priority: 'high' },
            { title: 'Verify Artifact', assigneeSlug: 'charlie', dependsOnIndices: [0] },
            { title: 'Reopenable Task', assigneeSlug: 'bob' },
            { title: 'Atomic Share Task', assigneeSlug: 'bob' },
          ],
          notifyAssignees: false,
          actor: 'agent',
        })
        assert.equal(dagBatch.ok, true)
        const [tBuild, tVerify, tReopen, tAtomic] = dagBatch.tasks

        // A. Inside an active Agent turn: updateTask(done) defers DONE & UNBLOCKED until endTurn()
        const endBobTurn = bob.beginAgentTurn({ roomId: orderRoomId, sessionId: 'sess-bob-order', hop: 1 })
        const earlyDone = await bob.updateTask({
          roomId: orderRoomId,
          taskId: tBuild.id,
          status: 'done',
          summary: 'draft summary v1',
          actor: 'agent',
        })
        assert.equal(earlyDone.ok, true)
        assert.equal(earlyDone.handoffDeferred, true, 'Handoff must be deferred while Agent turn is still active')
        assert.equal(bob.hasPendingTurnNotification(orderRoomId), true)

        // Confirm neither DONE nor UNBLOCKED has been sent yet!
        const msgsBeforeEnd = alice.store.getSnapshot().messages[orderRoomId] || []
        assert.equal(msgsBeforeEnd.some((m) => String(m.text || '').includes('DONE')), false, 'Moderator must not be woken mid-turn')
        assert.equal(msgsBeforeEnd.some((m) => String(m.text || '').includes('UNBLOCKED')), false, 'Downstream peer must not be woken mid-turn')

        // Bob shares a late/revised deliverable file AFTER calling updateTask(done), then revises summary
        const lateFile = join(bobDir, 'late-report.md')
        writeFileSync(lateFile, '# Final Revised Report\nAll checks passed.\n', 'utf8')
        const sharedLate = await bob.sendFile({
          roomId: orderRoomId,
          filePath: lateFile,
          text: 'late revised report',
          actor: 'agent',
        })
        assert.equal(sharedLate.ok, true)
        const revisedDone = await bob.updateTask({
          roomId: orderRoomId,
          taskId: tBuild.id,
          status: 'done',
          summary: 'final summary v2 after late file',
          artifacts: ['late-report.md'],
          actor: 'agent',
        })
        assert.equal(revisedDone.ok, true)
        assert.equal(revisedDone.handoffDeferred, true)

        // Also test reopen cancellation within the same turn: done -> in_progress must NOT emit handoff!
        await bob.updateTask({ roomId: orderRoomId, taskId: tReopen.id, status: 'done', summary: 'oops premature', actor: 'agent' })
        await bob.updateTask({ roomId: orderRoomId, taskId: tReopen.id, status: 'in_progress', summary: 'still working', actor: 'agent' })

        // End Bob's turn -> flushes in strict causal order: FILE -> DONE (with v2 summary) -> UNBLOCKED
        await endBobTurn()
        const msgsAfterEnd = alice.store.getSnapshot().messages[orderRoomId] || []
        const fileIdx = msgsAfterEnd.findIndex((m) => m.kind === 'file' && m.attachment?.name === 'late-report.md')
        const doneIdx = msgsAfterEnd.findIndex((m) => m.taskId === tBuild.id && String(m.text || '').includes('· DONE]'))
        const unblockedIdx = msgsAfterEnd.findIndex((m) => m.taskId === tVerify.id && String(m.text || '').includes('· UNBLOCKED]'))
        assert.ok(fileIdx >= 0, 'Late file must be present')
        assert.ok(doneIdx > fileIdx, 'Task DONE notice must appear strictly AFTER late file upload')
        assert.ok(unblockedIdx > doneIdx, 'Downstream UNBLOCKED wake must appear strictly AFTER upstream DONE notice')
        assert.ok(String(msgsAfterEnd[doneIdx].text || '').includes('final summary v2 after late file'), 'Flushed DONE notice must carry the coalesced latest summary')
        assert.equal(
          msgsAfterEnd.some((m) => m.taskId === tReopen.id && String(m.text || '').includes('· DONE]')),
          false,
          'Reopened task must NOT emit stale DONE notification at turn end',
        )

        // B. Atomic shareFiles on updateTask: invalid file fails BEFORE mutating status; valid file shares BEFORE DONE
        const badAtomic = await bob.updateTask({
          roomId: orderRoomId,
          taskId: tAtomic.id,
          status: 'done',
          shareFiles: ['does-not-exist-anywhere.txt'],
          actor: 'agent',
        })
        assert.equal(badAtomic.ok, false, 'Missing shareFiles path must fail before mutating task status')
        assert.equal(bob.store.getTask(orderRoomId, tAtomic.id)?.status, 'todo', 'Task status must remain unchanged when shareFiles fails')

        const atomicFile = join(bobDir, 'atomic-deliverable.txt')
        writeFileSync(atomicFile, 'atomic payload ok', 'utf8')
        const okAtomic = await bob.updateTask({
          roomId: orderRoomId,
          taskId: tAtomic.id,
          status: 'done',
          summary: 'atomic done with file',
          shareFiles: ['atomic-deliverable.txt'],
          actor: 'agent',
        })
        assert.equal(okAtomic.ok, true)
        assert.deepEqual(okAtomic.sharedFiles, ['atomic-deliverable.txt'])
        assert.ok(okAtomic.task.artifacts.includes('atomic-deliverable.txt'), 'Shared file must be auto-recorded in artifacts')
        const msgsFinal = alice.store.getSnapshot().messages[orderRoomId] || []
        const atomicFileIdx = msgsFinal.findIndex((m) => m.kind === 'file' && m.attachment?.name === 'atomic-deliverable.txt')
        const atomicDoneIdx = msgsFinal.findIndex((m) => m.taskId === tAtomic.id && String(m.text || '').includes('· DONE]'))
        assert.ok(atomicFileIdx >= 0 && atomicDoneIdx > atomicFileIdx, 'Atomic shareFiles upload must land strictly before DONE notice')
      }

      // 14i. Auto-release of superseded blocked tasks, DAG blocker unblocking, approval unblock, and human /local/cli task-update
      {
        const blkGrp = await alice.createGroup({
          name: 'Blocker Release Squad',
          memberSlugs: ['bob', 'charlie'],
          moderatorSlug: 'alice',
        })
        assert.equal(blkGrp.ok, true)
        const blkRoomId = blkGrp.room.id

        // 1) Title-similar & explicit-replacesTaskId auto-superseding in createTasks + live peer sync
        const initialBatch = await alice.createTasks({
          roomId: blkRoomId,
          tasks: [
            { title: '服务详情面板与告警中心审查', assigneeSlug: 'charlie' },
            { title: '后端 API 功能审查', assigneeSlug: 'charlie' },
            { title: '高危生产发布审批', assigneeSlug: 'charlie', approvalRequired: true, approvalPrompt: 'Approve prod' },
          ],
          notifyAssignees: false,
          actor: 'agent',
        })
        assert.equal(initialBatch.ok, true)
        const [tReview1, tApi1, tApprovalGate] = initialBatch.tasks

        // Charlie marks all three blocked
        await charlie.updateTask({ roomId: blkRoomId, taskId: tReview1.id, status: 'blocked', summary: 'missing panel', actor: 'agent', notifyModerator: false })
        await charlie.updateTask({ roomId: blkRoomId, taskId: tApi1.id, status: 'blocked', summary: 'missing endpoint', actor: 'agent', notifyModerator: false })
        await charlie.updateTask({ roomId: blkRoomId, taskId: tApprovalGate.id, status: 'blocked', summary: 'waiting approval', actor: 'agent', notifyModerator: false })
        assert.equal(alice.store.getTask(blkRoomId, tReview1.id)?.status, 'blocked')

        // Moderator dispatches follow-up with qualifier ("最终审查") -> auto-cancels tReview1 & syncs to Charlie!
        const followUp1 = await alice.createTasks({
          roomId: blkRoomId,
          tasks: [
            { title: '服务详情面板与告警中心最终审查', assigneeSlug: 'charlie' },
          ],
          notifyAssignees: false,
          actor: 'agent',
        })
        assert.equal(followUp1.ok, true)
        assert.equal(followUp1.supersededTasks.length, 1)
        assert.equal(followUp1.supersededTasks[0].id, tReview1.id)
        assert.equal(alice.store.getTask(blkRoomId, tReview1.id)?.status, 'cancelled')
        assert.equal(charlie.store.getTask(blkRoomId, tReview1.id)?.status, 'cancelled', 'Peer must receive cancelled sync for superseded blocker')

        // Pending human approval gate must NEVER be auto-cancelled even if agent passes replacesTaskId
        const tryBypass = await alice.createTasks({
          roomId: blkRoomId,
          tasks: [
            { title: '高危生产发布审批', assigneeSlug: 'charlie', replacesTaskId: tApprovalGate.id },
          ],
          notifyAssignees: false,
          actor: 'agent',
        })
        assert.equal(tryBypass.ok, true)
        assert.equal(alice.store.getTask(blkRoomId, tApprovalGate.id)?.status, 'blocked', 'Pending human approval gate must never be auto-cancelled by agent')

        // Approving a blocked approval gate automatically releases the block into in_progress
        const decided = await alice.decideApproval({
          roomId: blkRoomId,
          taskId: tApprovalGate.id,
          decision: 'approved',
          comment: 'LGTM',
        })
        assert.equal(decided.ok, true)
        assert.equal(alice.store.getTask(blkRoomId, tApprovalGate.id)?.status, 'in_progress')
        assert.equal(charlie.store.getTask(blkRoomId, tApprovalGate.id)?.status, 'in_progress')

        // 2) Auto-release on updateTask(done): older same-title blocked task closes AND DAG blocked downstream reopens
        const dagRes = await alice.createTasks({
          roomId: blkRoomId,
          tasks: [
            { title: '后端接口修复', assigneeSlug: 'bob' },
            { title: '端到端冒烟验收', assigneeSlug: 'charlie', dependsOnIndices: [0] },
          ],
          notifyAssignees: false,
          actor: 'agent',
        })
        assert.equal(dagRes.ok, true)
        const [tFixApi, tSmoke] = dagRes.tasks

        // Manually inject a concurrent older blocked duplicate with exact title to test updateTask(done) fallback
        const dupApi = alice.store.createTask(blkRoomId, {
          threadId: tApi1.threadId,
          title: '后端 API 功能审查',
          assigneeSlug: 'charlie',
          createdBy: 'alice',
          status: 'todo',
        })
        await alice.updateTask({ roomId: blkRoomId, taskId: tSmoke.id, status: 'blocked', summary: 'waiting on backend fix', actor: 'agent', notifyModerator: false })
        assert.equal(alice.store.getTask(blkRoomId, tApi1.id)?.status, 'blocked')
        assert.equal(alice.store.getTask(blkRoomId, tSmoke.id)?.status, 'blocked')

        // Completing dupApi automatically releases tApi1 (cancelled) across all peers!
        const dupDone = await alice.updateTask({
          roomId: blkRoomId,
          taskId: dupApi.id,
          status: 'done',
          summary: 'all endpoints verified',
          actor: 'agent',
          notifyModerator: false,
        })
        assert.equal(dupDone.ok, true)
        assert.equal(alice.store.getTask(blkRoomId, tApi1.id)?.status, 'cancelled')
        assert.equal(charlie.store.getTask(blkRoomId, tApi1.id)?.status, 'cancelled')

        // Completing upstream tFixApi automatically unblocks downstream DAG blocked task tSmoke -> todo!
        const fixDone = await bob.updateTask({
          roomId: blkRoomId,
          taskId: tFixApi.id,
          status: 'done',
          summary: 'fixed api',
          actor: 'agent',
          notifyModerator: false,
        })
        assert.equal(fixDone.ok, true)
        assert.equal(bob.store.getTask(blkRoomId, tSmoke.id)?.status, 'todo')
        assert.equal(alice.store.getTask(blkRoomId, tSmoke.id)?.status, 'todo')

        // 3) /local/cli task-update with actor='human' updates a blocked task & syncs to peers
        const manualTask = alice.store.createTask(blkRoomId, {
          title: '人工介入排查',
          assigneeSlug: 'bob',
          createdBy: 'alice',
          status: 'blocked',
        })
        await bob.updateTask({ roomId: blkRoomId, taskId: tSmoke.id, status: 'in_progress', actor: 'agent', notifyModerator: false })
        const cliUpdate = await alice.handleIncomingMeshHttp(
          'POST',
          '/local/cli',
          { authorization: `Bearer ${alice.localToken}` },
          JSON.stringify({
            action: 'task-update',
            roomId: blkRoomId,
            taskId: manualTask.id,
            status: 'done',
            summary: 'Resolved by human operator',
            actor: 'human',
            notifyModerator: false,
          }),
        )
        assert.equal(cliUpdate.status, 200)
        assert.equal(cliUpdate.body.ok, true)
        assert.equal(alice.store.getTask(blkRoomId, manualTask.id)?.status, 'done')
        assert.equal(bob.store.getTask(blkRoomId, manualTask.id)?.status, 'done', 'Human CLI task-update must sync to peers')
      }

      await aliceCtx.fiber.dispose()
      await bobCtx.fiber.dispose()
    }
  }

  console.log('host-live ok')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
