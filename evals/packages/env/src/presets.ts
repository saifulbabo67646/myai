import { defineWorld } from "./topology.ts";

export const soloWorkspace = defineWorld({
  den: {
    orgs: {
      acme: { admin: {} },
    },
  },
  apps: {
    main: { signedInTo: { org: "acme", as: "admin" } },
  },
});

export const desktopProductionLive = defineWorld({
  den: { orgs: {}, substrate: "local" },
  apps: {
    main: {
      desktopState: { source: "installed-production", mode: "live-shared" },
    },
  },
});

export const supportOrg = defineWorld({
  den: {
    orgs: {
      acme: {
        admin: {},
        members: { jordan: {} },
      },
      globex: { admin: { name: "Gwen" } },
    },
  },
  apps: {
    alice: { signedInTo: { org: "acme", as: "admin" } },
    bob: {},
  },
});

export const acmeDemo = defineWorld({
  den: {
    orgs: {
      "Acme Robotics": {},
    },
    ports: { api: 8790, web: 3005 },
    seed: "demo-org",
  },
  apps: {
    alex: { signedInTo: { org: "Acme Robotics", as: "admin" } },
    jordan: {},
  },
});

export const acmeDocs = defineWorld({
  den: {
    orgs: {
      "Acme Robotics": {
        admin: { name: "Alex Rivera", email: "alex@acme.dev" },
        members: {
          jordan: { name: "Jordan Lee", email: "jordan@acme.dev" },
        },
        capabilities: { mcpConnections: true, cloud: true },
        plugins: [
          {
            name: "Customer Research",
            description: "Prepare for sales calls with a structured company brief.",
            skill: {
              name: "customer-research",
              description: "Research a company and summarize key facts before a sales call.",
              body: "# Instructions\n\n1. Gather the company's product, size, and recent news.\n2. Summarize the three facts that matter for this call.\n3. Suggest one opening question.",
            },
          },
          {
            name: "Weekly Status Report",
            description: "Draft the weekly status update from recent activity.",
            skill: {
              name: "weekly-status-report",
              description: "Draft the weekly status update from this week's activity.",
              body: "# Instructions\n\n1. Collect what shipped, what slipped, and what is blocked.\n2. Write a five-line update in the team's usual format.",
            },
          },
          {
            name: "Meeting Notes",
            description: "Turn a transcript into structured meeting notes.",
            skill: {
              name: "meeting-notes",
              description: "Turn a meeting transcript into decisions, owners, and follow-ups.",
              body: "# Instructions\n\n1. Extract decisions, owners, and deadlines from the transcript.\n2. List open questions at the end.",
            },
          },
        ],
        connections: [{ name: "Slack", witness: "slack" }],
        desktopPolicies: [{
          name: "Product operations prompts",
          priority: 100,
          members: ["jordan"],
          teams: [{ name: "Product Operations", members: ["jordan"] }],
          promptCards: [
            {
              title: "Prepare a customer briefing",
              prompt: "Review this workspace and prepare a briefing with customer goals, recent decisions, risks, and next steps.",
            },
            {
              title: "Turn meeting notes into action",
              prompt: "Turn the latest meeting notes into an action plan with owners, deadlines, dependencies, and open questions.",
            },
            {
              title: "Draft the weekly project update",
              prompt: "Summarize project progress, risks, decisions, and next week's priorities for the leadership team.",
            },
          ],
        }],
      },
    },
  },
  apps: {
    docs: {
      signedInTo: { org: "Acme Robotics", as: "jordan" },
      workspacePath: "/tmp/acme/acme-robotics",
    },
  },
  witnesses: {
    slack: { kind: "mcp" },
  },
});
