import { createMachine } from "xstate";

export const machine = createMachine(
  {
    id: `Ping/Pong`,
    initial: `Pinged`,
    states: {
      Pinged: {
        on: {
          ON_SERVER: {
            target: `Ponged`,
          },
        },
      },
      Ponged: {
        type: `final`,
      },
    },
    schema: { events: {} as { type: `ON_SERVER` } },
    predictableActionArguments: true,
    preserveActionOrder: true,
  },
  {
    actions: {},
    services: {},
    guards: {},
    delays: {},
  },
);
