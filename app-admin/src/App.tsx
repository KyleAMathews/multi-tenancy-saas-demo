import { useState } from "react"
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  TextField,
  Label,
  Modal,
  TextArea,
} from "react-aria-components"
import { useYjs, useSubscribeYjs, useAwarenessStates } from "situated"
import "./App.css"
import { format } from "timeago.js"
import { createTRPCProxyClient, loggerLink } from "@trpc/client"
import { link as yjsLink } from "trpc-yjs/link"
import { AppRouter } from "../../server/trpc"

const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    loggerLink(),
    yjsLink({
      doc: window.rootDoc,
    }),
  ],
})

window.trpc = trpc

function makeid(length) {
  let result = ""
  const characters = "abcdefghijklmnopqrstuvwxyz0123456789"
  const charactersLength = characters.length
  let counter = 0
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength))
    counter += 1
  }
  return result
}

const appServerBase =
  process.env.NODE_ENV === `production`
    ? `https://app-server-todos-saas.fly.dev/todos/`
    : `http://localhost:10000/todos/`

function SelectModal({ dbName, requests }) {
  const selects = requests
    .filter((request) => {
      return (
        request.path == `selectDb` &&
        request.input.name === dbName &&
        request.error !== true
      )
    })
    .reverse()
    .slice(0, 5)

  return (
    <DialogTrigger>
      <Button
        style={{
          border: `1px solid gray`,
          marginRight: `0.5rem`,
        }}
      >
        Query
      </Button>
      <Modal>
        <Dialog>
          {({ close }) => (
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                const sql = e.target[0].value
                const res = await trpc.selectDb.query({
                  name: dbName,
                  sql,
                })
                console.log({ res })
              }}
            >
              <Heading>Run Query in {dbName}</Heading>
              <TextField autoFocus>
                <Label>SQL</Label>
                <TextArea defaultValue={`select * from todo`} />
              </TextField>
              <Button
                style={{ border: `1px solid gray`, marginBottom: `1rem` }}
                type="submit"
              >
                Submit
              </Button>
              <Heading>Previous Queries ({selects.length})</Heading>
              <div>
                {selects.map((request) => {
                  return (
                    <div>
                      <div>
                        <pre>{request.input.sql}</pre>
                      </div>
                      <div>{JSON.stringify(request.response?.results)}</div>
                    </div>
                  )
                })}
              </div>
            </form>
          )}
        </Dialog>
      </Modal>
    </DialogTrigger>
  )
}

function App() {
  const { rootDoc } = useYjs()
  const [createDbError, setDbError] = useState(``)
  const requestsArrayYjs = rootDoc.getArray(`trpc-calls`)
  const dbsYjs = rootDoc.getMap(`dbs`)

  // Subscribe to updates.
  const requests = useSubscribeYjs(requestsArrayYjs) || []
  const dbs = useSubscribeYjs(dbsYjs) || {}

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>TODOs SaaS Admin</h1>
      <form
        style={{
          paddingBottom: `2rem`,
          display: `flex`,
          flexDirection: `column`,
          width: `12rem`,
        }}
        onSubmit={async (e) => {
          e.preventDefault()
          const name = e.target[0].value
          setDbError(``)
          e.target.reset()
          try {
            const newDb = await trpc.createDb.mutate({ name })
            console.log({ newDb })
          } catch (e) {
            setDbError(e.message)
          }
        }}
      >
        <label>App Instance Name</label>
        <input type="text" style={{ marginBottom: `0.5rem` }} />
        {createDbError !== `` && <div>{createDbError}</div>}
        <button>Create App</button>
      </form>
      <div>
        {Object.values(dbs)
          .reverse()
          .filter(db => db.name !== `do-not-delete`)
          .sort((a, b) => {
            return a.updatedAt > b.updatedAt
              ? -1
              : a.updatedAt < b.updatedAt
              ? 1
              : 0
          })
          .map((db) => {
            return (
              <div
                key={db.name}
                style={{
                  marginBottom: `1rem`,
                  paddingBottom: `1rem`,
                  borderBottom: `1px solid gray`,
                }}
              >
                <h3 style={{ marginTop: 0, marginBottom: `0.5rem` }}>
                  {db.name}
                </h3>
                <small>Last updated {format(db.updatedAt)}</small>
                <div>{db.state}</div>
                {db.state === `READY` && (
                  <div>
                    <a href={`${appServerBase}${db.name}`}>Open Instance</a>
                    <div>
                      {db.total} TODOs with {db.completed} completed
                    </div>
                    <div style={{ marginBottom: `0.5rem` }}>
                      <em>db: {db.url}</em>
                    </div>
                    <SelectModal requests={requests} dbName={db.name} />
                    <button
                      style={{
                        border: `1px solid gray`,
                        marginRight: `0.5rem`,
                      }}
                      onClick={async () => {
                        const name = `${db.name}-${
                          new Date().toISOString().split("T")[0]
                        }-${makeid(5)}`
                        const maybeTruncated =
                          name.length < 28 ? name : name.substring(0, 27)
                        await trpc.createDb.mutate({
                          name: maybeTruncated,
                          fromDb: db.name,
                        })
                      }}
                    >
                      Clone
                    </button>
                    <button
                      style={{
                        border: `1px solid gray`,
                        marginRight: `0.5rem`,
                      }}
                      onClick={async () => {
                        await trpc.deleteDb.mutate({ name: db.name })
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

export default App
