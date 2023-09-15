import { v4 as uuidv4 } from "uuid"

export async function createRequest({ doc, mutator, request }) {
  const requests = doc.getArray(`requests`)
  const requestId = uuidv4()
  let resolveFunc, rejectFunc

  const promise = new Promise((resolve, reject) => {
    // Storing the resolve and reject functions for later use.
    resolveFunc = resolve
    rejectFunc = reject
  })
  function observe(event) {
    const inserted = event.changes.delta.find(
      (item) => Object.keys(item)[0] === `insert`
    )
    const state = inserted.insert[0]
    // TODO only do this in case of user-directed timeout or network
    // disconnect errors e.g. normally we're fine just waiting to go online
    // but the app might want to error immediately if we disconnect or are offline.
    // if (state.error) {
    // requests.unobserve(observe)
    // return rejectFunc(state)
    // }
    if (state.done) {
      requests.unobserve(observe)
      return resolveFunc(state)
    }
  }

  requests.observe(observe)
  requests.push([
    {
      mutator,
      value: `requested`,
      id: requestId,
      done: false,
      clientCreate: new Date().toJSON(),
      request,
      response: {},
    },
  ])

  return promise
}
