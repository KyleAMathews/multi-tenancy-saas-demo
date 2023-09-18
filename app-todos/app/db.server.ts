import Database from "libsql"
import { singleton } from "./singleton.server";

const getDb = (dbName) => singleton(`getDb${dbName}`, () =>  new Database(`../server/.cache/dbs/${dbName}.db`));

export { getDb };
