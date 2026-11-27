import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createMeshService } from '../index.js'

const tempDir = mkdtempSync(join(tmpdir(), 'mesh-wake-events-'))

try {
  let peerSleeping = false
  const wakeRequests = []
  const controlEvents = []
  const nodes = new Map()

  const customFetch = async (url, options = {}) => {
    const u = String(url)
    if (u.startsWith('http://manager.local/api/internal/mesh/wake/')) {
      const slug = decodeURIComponent(u.split('/').pop() || '')
      wakeRequests.push({
        slug,
        callerSlug: options.headers?.['x-metis-sandbox-slug'],
        authSecret: options.headers?.['x-metis-gateway-auth'],
      })
      peerSleeping = false
      return new Response(JSON.stringify({ ok: true, slug, woke: true, status: 'running' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (u === 'http://manager.local/api/internal/mesh/events') {
      controlEvents.push({
        callerSlug: options.headers?.['x-metis-sandbox-slug'],
        authSecret: options.headers?.['x-metis-gateway-auth'],
        body: JSON.parse(options.body || '{}'),
      })
      return new Response(JSON.stringify({ ok: true, synced_runs: 1, advanced: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (u === 'http://manager.local/api/internal/mesh/tool-check') {
      const payload = JSON.parse(options.body || '{}')
      const needsApproval = String(payload.args_summary || '').includes('git push')
      return new Response(
        JSON.stringify(
          needsApproval
            ? { allowed: false, action: 'require_approval', rule_name: 'Approve Git Push', approval_id: 'ap-123' }
            : { allowed: true, action: 'allow', rule_name: null, approval_id: null },
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (u === 'http://manager.local/api/internal/mesh/tool-check/ap-123') {
      return new Response(JSON.stringify({ id: 'ap-123', status: 'approved', tool_name: 'bash_exec' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const match = u.match(/^https:\/\/mesh\.example\.com\/s\/([^/]+)\/p\/4090(\/.*)$/)
    if (match) {
      const [, slug, path] = match
      if (slug === 'peerb' && peerSleeping) {
        return new Response(
          JSON.stringify({ detail: 'sleeping', sleeping: true, slug: 'peerb' }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        )
      }
      const target = nodes.get(slug)
      if (!target) {
        return new Response(JSON.stringify({ ok: false, error: 'unknown node' }), { status: 404 })
      }
      const res = await target.handleIncomingMeshHttp(
        options.method || 'POST',
        path,
        options.headers || {},
        options.body || '',
        { remoteAddress: '10.0.0.1' },
      )
      return new Response(JSON.stringify(res.body), {
        status: res.status || 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ ok: false, error: `unexpected url ${u}` }), { status: 404 })
  }

  const peerA = createMeshService({
    config: {
      storagePath: join(tempDir, 'peera.json'),
      homeDir: join(tempDir, 'home-a'),
      slug: 'peera',
      ownerName: 'Alice PM',
      ownerEmail: 'alice@example.com',
      publicOrigin: 'https://mesh.example.com',
      port: 4090,
      managerUrl: 'http://manager.local',
      gatewayAuthSecret: 'secret-a',
    },
    fetchImpl: customFetch,
  })
  const peerB = createMeshService({
    config: {
      storagePath: join(tempDir, 'peerb.json'),
      homeDir: join(tempDir, 'home-b'),
      slug: 'peerb',
      ownerName: 'Bob Dev',
      ownerEmail: 'bob@example.com',
      publicOrigin: 'https://mesh.example.com',
      port: 4090,
      managerUrl: 'http://manager.local',
      gatewayAuthSecret: 'secret-b',
    },
    fetchImpl: customFetch,
  })
  nodes.set('peera', peerA)
  nodes.set('peerb', peerB)

  // Pair peerA -> peerB while peerB is online
  const inv = peerB.store.createPairCode()
  const claim = await peerA.claimPairInvite(inv.inviteUri)
  assert.equal(claim.ok, true)

  // Put peerB to sleep! Sending a message from peerA wakes peerB automatically via Control Plane & succeeds!
  peerSleeping = true
  const sendRes = await peerA.sendMessage({
    roomId: 'pair:peera:peerb',
    text: 'Wake up and check payments v2',
    actor: 'agent',
  })
  assert.equal(sendRes.ok, true)
  assert.equal(wakeRequests.length, 1)
  assert.equal(wakeRequests[0].slug, 'peerb')
  assert.equal(wakeRequests[0].callerSlug, 'peera')
  assert.equal(wakeRequests[0].authSecret, 'secret-a')
  assert.equal(peerSleeping, false)

  await new Promise((r) => setTimeout(r, 20))
  assert.ok(controlEvents.some((e) => e.body.event === 'message.agent' && e.body.roomId === 'pair:peera:peerb'))

  // Also test task.updated control-plane push
  const tCreate = await peerA.createTasks({
    roomId: 'pair:peera:peerb',
    tasks: [{ title: 'Deliver design', assigneeSlug: 'peerb' }],
  })
  assert.equal(tCreate.ok, true)
  const taskId = tCreate.tasks[0].id
  const tDone = await peerB.updateTask({
    roomId: 'pair:peera:peerb',
    taskId,
    status: 'done',
    summary: 'Completed design spec',
    actor: 'agent',
  })
  assert.equal(tDone.ok, true)
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(
    controlEvents.some(
      (e) =>
        e.callerSlug === 'peerb'
        && e.body.event === 'task.updated'
        && e.body.taskId === taskId
        && e.body.status === 'done',
    ),
  )

  // Verify Tool-Level HITL check + polling against control plane
  const chkAllowed = await peerA.checkControlPlaneToolPolicy('bash_exec', 'ls -la')
  assert.equal(chkAllowed.allowed, true)
  const chkGate = await peerA.checkControlPlaneToolPolicy('bash_exec', 'git push origin main')
  assert.equal(chkGate.allowed, false)
  assert.equal(chkGate.action, 'require_approval')
  assert.equal(chkGate.approval_id, 'ap-123')
  const polStatus = await peerA.checkControlPlaneToolApprovalStatus('ap-123')
  assert.equal(polStatus.status, 'approved')

  console.log('wake-and-events ok')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
