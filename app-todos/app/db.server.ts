import { createClient } from "@libsql/client";
import { singleton } from "./singleton.server";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

console.log(`getting ydoc`);

const doc = new Y.Doc();
const wsProvider = new WebsocketProvider(
  "ws://localhost:3000",
  "app-doc",
  doc,
  { WebSocketPolyfill: require("ws") }
);
wsProvider.on("status", (event) => {
  console.log(`yjs status`, event); // logs "connected" or "disconnected"
});

const getDb = (dbName) =>
  singleton(`getDb${dbName}`, () => {
    console.log(`get db singleton ${dbName}`);
    console.log({ doc });
    const db = doc.getMap(`dbs`).get(dbName);
    return createClient({ url: db.url, authToken: db.authToken });
  });

export { getDb };
