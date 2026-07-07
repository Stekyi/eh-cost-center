import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

const db = admin.firestore()

// Write an audit record
async function writeAudit(expenseId: string, action: 'create' | 'update' | 'delete', beforeData: any, afterData: any, ctx: functions.EventContext) {
  try {
    await db.collection('expenseItems_audit').add({
      expenseId,
      action,
      beforeData: beforeData || null,
      afterData: afterData || null,
      performedBy: (ctx.auth && ctx.auth.uid) || null,
      performedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch (err) {
    console.error('writeAudit err', err)
  }
}

export const onExpenseItemCreate = functions.firestore.document('expenseItems/{id}').onCreate(async (snap, ctx) => {
  const after = snap.data() || {}
  await writeAudit(snap.id, 'create', null, after, ctx)
})

export const onExpenseItemUpdate = functions.firestore.document('expenseItems/{id}').onUpdate(async (change, ctx) => {
  const before = change.before.data() || {}
  const after = change.after.data() || {}
  await writeAudit(change.after.id, 'update', before, after, ctx)
})

export const onExpenseItemDelete = functions.firestore.document('expenseItems/{id}').onDelete(async (snap, ctx) => {
  const before = snap.data() || {}
  try {
    // Archive the deleted document (preserve id)
    const archiveRef = db.collection('expenseItems_archive').doc(snap.id)
    await archiveRef.set({ ...before, archivedAt: admin.firestore.FieldValue.serverTimestamp() })
  } catch (err) {
    console.error('archive write failed', err)
  }
  await writeAudit(snap.id, 'delete', before, null, ctx)
})
