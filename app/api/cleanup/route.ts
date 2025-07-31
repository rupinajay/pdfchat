
import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs/promises"
import path from "path"

// Helper to clear uploads directory for a session
async function clearUploadsDirForSession(sessionId: string) {
  const uploadsDir = path.join(process.cwd(), "uploads")
  let deleted = 0
  try {
    const files = await fs.readdir(uploadsDir)
    for (const file of files) {
      if (file.startsWith(sessionId + "__")) {
        const filePath = path.join(uploadsDir, file)
        await fs.unlink(filePath)
        deleted++
      }
    }
    return { deleted }
  } catch (err) {
    return { deleted, error: err instanceof Error ? err.message : String(err) }
  }
}


// Helper to clear documentStore and sessionMeta for a session
function clearDocumentStoreForSession(sessionId: string) {
  let clearedCount = 0
  const ds = (globalThis as any).documentStore
  if (ds && typeof ds.delete === "function" && typeof ds["has"] === "function") {
    if (ds["has"](sessionId)) clearedCount = 1
    ds.delete(sessionId)
  }
  const sm = (globalThis as any).sessionMetaStore
  if (sm && typeof sm.delete === "function") {
    sm.delete(sessionId)
  }
  return { cleared: clearedCount }
}

// Helper to clean up idle sessions (default: 1 hour)
async function cleanupIdleSessions(idleMs = 60 * 60 * 1000) {
  const now = Date.now()
  const sessionMetaStore = ((globalThis as any).sessionMetaStore as Map<string, { lastActivity: number }>) || new Map()
  const documentStore = ((globalThis as any).documentStore as Map<string, Map<string, any>>) || new Map()
  const uploadsDir = path.join(process.cwd(), "uploads")
  let cleaned = 0
  for (const [sessionId, meta] of sessionMetaStore.entries()) {
    if (now - meta.lastActivity > idleMs) {
      // Delete uploaded files for this session
      try {
        const files = await fs.readdir(uploadsDir)
        for (const file of files) {
          if (file.startsWith(sessionId + "__")) {
            const filePath = path.join(uploadsDir, file)
            await fs.unlink(filePath)
          }
        }
      } catch {}
      // Delete vectors/session data
      documentStore.delete(sessionId)
      sessionMetaStore.delete(sessionId)
      cleaned++
    }
  }
  return cleaned
}

export async function POST() {
  // Clean up idle sessions (default: 1 hour)
  const idleCleaned = await cleanupIdleSessions()
  // Get sessionId from cookie
  const sessionId = cookies().get("sessionId")?.value
  if (!sessionId) {
    return NextResponse.json({ success: false, error: "No sessionId found in cookies.", idleCleaned }, { status: 400 })
  }
  // Delete uploaded files for this session
  const uploadsResult = await clearUploadsDirForSession(sessionId)
  // Clear in-memory vectors/session data for this session
  const docStoreResult = clearDocumentStoreForSession(sessionId)

  return NextResponse.json({
    success: true,
    uploads: uploadsResult,
    documentStore: docStoreResult,
    idleCleaned,
    message: `Uploads and document store cleared for session ${sessionId}. Idle sessions cleaned: ${idleCleaned}`
  })
}
