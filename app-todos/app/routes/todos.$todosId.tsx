import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  Link,
  NavLink,
  Outlet,
  useParams,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { useRef, useEffect } from "react";
import { getDb, syncAdminDb } from "~/db.server";
import { mapResultSet } from "../../../map-sqlite-resultset";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  // This will only sync the first time.
  await syncAdminDb(params.todosId)

  const db = getDb(params.todosId);
  const todos: Todo[] = mapResultSet(await db.execute(`select * from todo`));
  console.log({ todos });
  return json({
    todos: todos.map((todo) => {
      return { ...todo, completed: todo.completed === 1 };
    }),
  });
};

export let action: V2_ActionFunction = async ({ params, request }) => {
  const dbName = params.todosId;
  const db = getDb(params.todosId);
  if (request.method === "POST") {
    const data = new URLSearchParams(await request.text());
    const title = data.get("title") ?? "";
    const res = await db.execute({
      sql: `INSERT INTO Todo (title, completed) VALUES (?, 0)`,
      args: [title],
    });
    console.log({ res });
    await fetch(`http://localhost:3000/invalidate/${params.todosId}`, {
      method: `post`,
    });
    return json(res, {
      status: 201,
    });
  }
  if (request.method === "PUT") {
    const data = new URLSearchParams(await request.text());
    const todoId = data.get("completed");
    console.log(todoId);
    if (!todoId)
      return json(
        { error: "Todo id must be defined" },
        {
          status: 400,
        }
      );
    const todo = mapResultSet(await db.execute({
      sql: `SELECT * from Todo where id = ?`,
      args: [todoId],
    }))[0]
    console.log(todo);
    if (!todo) {
      return json(
        { error: "Todo does not exist" },
        {
          status: 400,
        }
      );
    }
    await db.execute({
      sql: `UPDATE TODO set completed=? where id = ?`,
      args: [todo.completed === 1 ? 0 : 1, todoId],
    });

    console.log({
      method: `post`,
      url: `http://localhost:3000/invalidate/${params.todosId}`,
    });

    await fetch(`http://localhost:3000/invalidate/${params.todosId}`, {
      method: `post`,
    });
    return json(`ok`, { status: 200 });
  }
  if (request.method === "DELETE") {
    const data = new URLSearchParams(await request.text());
    const todoId = data.get("delete");
    console.log(todoId);
    if (!todoId)
      return json(
        { error: "Todo id must be defined" },
        {
          status: 400,
        }
      );
    await db.execute({ sql: `DELETE from TODO where id = ?`, args: [todoId] });
    await fetch(`http://localhost:3000/invalidate/${params.todosId}`, {
      method: `post`,
    });
    return json(`ok`, { status: 200 });
  }

  return null;
};

type LoaderData = {
  todos: Todo[];
};

export default function Index() {
  let data = useLoaderData<LoaderData>();
  let params = useParams();
  let formRef = useRef<HTMLFormElement | null>(null);
  const transition = useNavigation();
  console.log({ data, formRef, transition });

  // data.todos = []

  useEffect(() => {
    if (transition.state === "loading") {
      formRef.current?.reset();
    }
  }, [transition.state]);

  return (
    <div style={{ width: "30%", margin: "0 auto", textAlign: "center" }}>
      <h1 className="text-2xl mb-4">{params.todosId} todos</h1>
      <ul className="mb-3" style={{ listStyleType: "none", padding: "0" }}>
        {data.todos.map((todo) => (
          <li key={todo.id}>
            <div
              style={{
                display: "flex",
                width: "100%",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <p
                style={{
                  marginRight: "1rem",
                  textDecoration: todo.completed ? "line-through" : "",
                }}
              >
                {todo.title}
              </p>
              <div style={{ display: "flex" }}>
                <Form method="put">
                  <input hidden name="completed" defaultValue={todo.id} />
                  <button>{"✅"}</button>
                </Form>
                <Form method="delete">
                  <input hidden name="delete" defaultValue={todo.id} />
                  <button> {"❌"} </button>
                </Form>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Form ref={formRef} method="post">
        <input
          style={{ border: `1px solid gray`, marginRight: `0.5rem` }}
          name="title"
          type="text"
        />
        <button
          style={{
            border: `1px solid gray`,
            padding: `0.25rem`,
            marginRight: `0.5rem`,
          }}
          type="submit"
        >
          Add
        </button>
      </Form>
    </div>
  );
}
