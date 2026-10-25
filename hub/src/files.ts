// Where the images live in R2: passes/<receiver id>/<pass>/thumb/<image path>.jpg and .../large/<image path>.jpg.
// The receiver's id, not its name: renaming a receiver changes nothing here.

export type Kind = 'thumb' | 'large'

export const receiverPrefix = (receiver: string) => `passes/${receiver}/`
export const passPrefix = (receiver: string, pass: string) => `${receiverPrefix(receiver)}${pass}/`
export const fileKey = (receiver: string, pass: string, kind: Kind, path: string) =>
  `${passPrefix(receiver, pass)}${kind}/${path}.jpg`

/** Delete everything under `prefix`, at most `rounds` × 1000 files per call. Returns whether all is gone
    (a big receiver takes several calls: the page repeats until it is). */
export async function deletePrefix(bucket: R2Bucket, prefix: string, rounds = 5): Promise<boolean> {
  for (let i = 0; i < rounds; i++) {
    const listed = await bucket.list({ prefix, limit: 1000 })
    if (listed.objects.length) await bucket.delete(listed.objects.map(o => o.key))
    if (!listed.truncated) return true
  }
  return false
}
