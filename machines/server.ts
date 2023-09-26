import * as Y from "yjs"

const isServerSync = true
export function listen({ doc, serverConfig }) {
  const requests = doc.getArray(`requests`)
  requests.observe(async (event) => {
    const inserted = event.changes.delta.find(
      (item) => Object.keys(item)[0] === `insert`
    )
    const retain = event.changes.delta.find(
      (item) => Object.keys(item)[0] === `retain`
    )
    const itemArray = retain?.retain || 0
    const state = event.target.get(itemArray)
    if (state.done !== true) {
      if (
        serverConfig.mutators.hasOwnProperty(state.mutator) &&
        serverConfig.mutators[state.mutator] instanceof Function
      ) {
        const mutatorFunc = await serverConfig.mutators[state.mutator]({
          state,
          doc,
        })
        doc.transact(() => {
          state.response = mutatorFunc()

          if (typeof state.response?.error !== `undefined`) {
            state.error = true
          } else {
            state.error = false
          }

          state.value = `responded`
          state.done = true
          state.serverResponded = new Date().toJSON()
          requests.delete(itemArray, 1)
          requests.insert(itemArray, [state])
        })
      } else {
        console.log(`bad request`)
        doc.transact(() => {
          state.error = true
          state.response = {
            error: `A mutator by that name does not exist`,
          }
        })
      }
    }
  })
}
