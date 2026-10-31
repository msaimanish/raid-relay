import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Outcome, QuestState } from "../../shared/src/index.js";
import "./style.css";

type Snapshot = {
  channelId: string;
  state: QuestState | null;
  channelDisplayName?: string;
  sourceDisplayName?: string | null;
  tallies?: {
    round: number;
    votes: number;
    raider: number;
    local: number;
    choices: Record<string, { raider: number; local: number }>;
  };
  simulated?: boolean;
  proposalCount?: number;
  demoMode?: boolean;
  candidates?: Array<{
    displayName: string;
    normalizedName: string;
    supportCount: number;
    firstProposedAt: number;
  }>;
  chainEvents?: Array<{
    sequence: number;
    type: string;
    at: number;
    data: Record<string, unknown>;
  }>;
  twitch?: {
    status: string;
    lastChatAt: number | null;
    lastRaidAt: number | null;
  };
  recap?: { text: string; recap_source: "ai" | "fallback" };
  publicBaseUrl?: string;
};

const pathParts = window.location.pathname.split("/").filter(Boolean);
const route = pathParts[0] ?? "";
const channel = decodeURIComponent(
  pathParts[1] ?? "channel_a_login",
).toLowerCase();
const query = new URLSearchParams(window.location.search);
const token = query.get("token") ?? "";
const overlayKey = query.get("overlayKey") ?? query.get("key") ?? "";

function useRelaySocket(
  role: "overlay" | "dashboard",
): [Snapshot | null, string] {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState("connecting");
  useEffect(() => {
    let socket: WebSocket | null = null;
    let stopped = false;
    let delay = 500;
    let retry: number | undefined;
    const connect = () => {
      const key = role === "dashboard" ? token : overlayKey;
      const url = new URL("/ws", window.location.href);
      url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("channel", channel);
      url.searchParams.set("role", role);
      url.searchParams.set("key", key);
      socket = new WebSocket(url);
      socket.onopen = () => {
        delay = 500;
        setConnection("live");
      };
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as {
            type?: string;
            data?: Partial<Snapshot>;
          };
          if (parsed.data) {
            setSnapshot((previous) =>
              parsed.type === "update" && previous
                ? { ...previous, ...parsed.data }
                : (parsed.data as Snapshot),
            );
          }
        } catch {
          setConnection("invalid update");
        }
      };
      socket.onclose = () => {
        setConnection("reconnecting");
        if (!stopped) {
          retry = window.setTimeout(connect, delay);
          delay = Math.min(delay * 2, 8000);
        }
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      stopped = true;
      if (retry) window.clearTimeout(retry);
      socket?.close();
    };
  }, [role]);
  return [snapshot, connection];
}

function formatRemaining(deadlineAt: number | null): string {
  if (deadlineAt === null) return "";
  const seconds = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function useClock(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function Overlay() {
  const [snapshot, connection] = useRelaySocket("overlay");
  useClock();
  const state = snapshot?.state;
  const tallies = snapshot?.tallies;
  const beat =
    state?.status === "BEAT2_VOTING" ||
    state?.status === "WELCOME" ||
    state?.status === "COMPLETED"
      ? 2
      : 1;
  const choices =
    beat === 1 ? ["protect", "claim"] : ["fight", "trade", "sneak"];
  const totalVotes = tallies?.votes ?? 0;
  const recap =
    snapshot?.recap?.text ??
    (state?.lastVoteResolution?.choice
      ? `The last group chose ${state.lastVoteResolution.choice}. ${state.canonName ?? "The Ember Fox"} is now part of the story.`
      : `${state?.objective ?? "Carry the Ember Relic to the end of the road."} Your vote helps decide what happens next.`);
  return (
    <main className="overlay-shell">
      <header className="overlay-top">
        <span className="brand-mark">RR</span>
        <span>
          RAID RELAY <small>· THE EMBER RELIC</small>
        </span>
        {snapshot?.simulated && <b className="simulated">SIMULATED</b>}
      </header>
      {!state ? (
        <>
          <div className="quest-chip">
            <span>The Ember Relic</span>
            <span>IDLE</span>
            <span>Canon pending</span>
          </div>
          <section className="hero">
            <span className="eyebrow">
              LIVE STORY · {connection.toUpperCase()}
            </span>
            <h1>
              Ready for the next
              <br />
              chapter?
            </h1>
            <p>When a quest begins, its story and votes appear here.</p>
          </section>
        </>
      ) : (
        <>
          <div className="quest-chip">
            <span>{state.title}</span>
            <span>CHAPTER {beat} / 2</span>
            <span>{state.canonName ?? "Name pending"}</span>
          </div>
          {state.status === "NAMING_OPEN" && (
            <section className="hero">
              <span className="eyebrow">THE FIRST CHAPTER</span>
              <h1>Name the creature.</h1>
              <p>
                Type <code>!name &lt;name&gt;</code> in chat.
              </p>
              <div className="countdown">
                {formatRemaining(state.deadlineAt)}
              </div>
              <div className="proposal-count">
                {snapshot?.proposalCount ?? 0} names proposed
              </div>
            </section>
          )}
          {state.status === "NAME_PENDING_APPROVAL" && (
            <section className="hero">
              <span className="eyebrow">STREAMER REVIEW</span>
              <h1>
                A name is being
                <br />
                considered.
              </h1>
              <p>The canon name will be revealed after approval.</p>
            </section>
          )}
          {state.status === "BEAT1_VOTING" && (
            <section className="story-card">
              <span className="eyebrow">CHAPTER ONE · THE SEALED RELIC</span>
              <h1>
                A relic hums beside
                <br />a sleeping creature.
              </h1>
              <p>
                Type <code>!vote protect</code> or <code>!vote claim</code>.
              </p>
              <Voting
                choices={choices}
                tallies={tallies?.choices ?? {}}
                total={totalVotes}
                remaining={formatRemaining(state.deadlineAt)}
              />
            </section>
          )}
          {(state.status === "HANDOFF_OFFERED" ||
            state.status === "WELCOME") && (
            <section className="welcome-card">
              <span className="eyebrow">A NEW PARTY HAS ARRIVED</span>
              <h1>Raiders from {state.sourceChannelId ?? "another channel"}</h1>
              <div className="party-size">
                {state.partySize === null
                  ? "Party size unavailable"
                  : `${state.partySize} viewers`}{" "}
                <span>· {state.partyTier} party</span>
              </div>
              <p className="recap">{recap}</p>
              <div className="canon-badge">
                ✦ {state.canonName ?? "the Ember Fox"} ✦
              </div>
              <p className="instructions">
                Raiders: <code>!join</code> · Everyone: <code>!vote 1/2/3</code>
              </p>
            </section>
          )}
          {state.status === "BEAT2_VOTING" && (
            <section className="story-card">
              <span className="eyebrow">CHAPTER TWO · THE TOLL BRIDGE</span>
              <h1>
                A troll guards the
                <br />
                bridge ahead.
              </h1>
              <p>
                Type <code>!join</code> if you came with the raid, then vote.
              </p>
              <Voting
                choices={choices}
                tallies={tallies?.choices ?? {}}
                total={totalVotes}
                remaining={formatRemaining(state.deadlineAt)}
              />
            </section>
          )}
          {state.status === "COMPLETED" && (
            <OutcomeCard outcome={state.outcome} state={state} />
          )}
          {state.status === "HANDOFF_DISMISSED" && (
            <section className="story-card">
              <span className="eyebrow">HANDOFF CLOSED</span>
              <h1>This chapter rests.</h1>
              <p>The receiving streamer dismissed the incoming story.</p>
            </section>
          )}
          {state.pausedAt !== null && (
            <div className="pause-ribbon">STORY PAUSED</div>
          )}
        </>
      )}
      <footer className="overlay-footer">
        <span>Each community counts equally.</span>
        <span>
          {connection === "live" ? "● LIVE" : `○ ${connection.toUpperCase()}`}
        </span>
      </footer>
    </main>
  );
}

function Voting({
  choices,
  tallies,
  total,
  remaining,
}: {
  choices: string[];
  tallies: Record<string, { raider: number; local: number }>;
  total: number;
  remaining: string;
}) {
  const max = Math.max(
    1,
    ...choices.map(
      (choice) =>
        (tallies[choice]?.raider ?? 0) + (tallies[choice]?.local ?? 0),
    ),
  );
  return (
    <div className="voting-panel">
      <div className="vote-head">
        <span>{total} valid votes</span>
        <b>{remaining}</b>
      </div>
      {choices.map((choice) => {
        const raider = tallies[choice]?.raider ?? 0;
        const local = tallies[choice]?.local ?? 0;
        return (
          <div className="choice-row" key={choice}>
            <strong>{choice}</strong>
            <div className="bar-stack">
              <div
                className="bar incoming"
                style={{ width: `${Math.max(4, (raider / max) * 100)}%` }}
              />
              <div
                className="bar locals"
                style={{ width: `${Math.max(4, (local / max) * 100)}%` }}
              />
            </div>
            <span className="vote-count">
              {raider} / {local}
            </span>
          </div>
        );
      })}
      <div className="legend">
        <span>▰ Incoming party</span>
        <span>▧ Locals</span>
      </div>
      <small>Each community counts equally.</small>
    </div>
  );
}

function OutcomeCard({
  outcome,
  state,
}: {
  outcome: Outcome | null;
  state: QuestState;
}) {
  const chainUrl = `${window.location.origin}/chain/${encodeURIComponent(state.id)}`;
  return (
    <section className="outcome-card">
      <span className="eyebrow">THE STORY CONTINUES</span>
      <h1>{outcome?.choice ?? "The road goes on"}</h1>
      <p className="outcome-text">
        {outcome?.text ?? "The party reaches the end of this chapter."}
      </p>
      <div className="outcome-details">
        <span>
          CANON <b>{state.canonName}</b>
        </span>
        <span>
          RELIC <b>{outcome?.stateDelta.relic}</b>
        </span>
        <span>
          BOND{" "}
          <b>
            {(outcome?.stateDelta.bond ?? 0) > 0 ? "+" : ""}
            {outcome?.stateDelta.bond ?? 0}
          </b>
        </span>
      </div>
      <a href={chainUrl}>Full story ↗</a>
    </section>
  );
}

function Dashboard() {
  const [snapshot, connection] = useRelaySocket("dashboard");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const state = snapshot?.state;
  const api = useCallback(async (path: string, body?: unknown) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dashboard-token": token,
        },
        body: body === undefined ? "{}" : JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? `Request failed (${response.status})`);
      setMessage("Action completed");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }, []);
  const button = (
    label: string,
    path: string,
    body?: unknown,
    primary = false,
  ) => (
    <button
      className={primary ? "primary" : ""}
      disabled={busy}
      onClick={() => void api(path, body)}
    >
      {label}
    </button>
  );
  const tally = snapshot?.tallies;
  return (
    <main className="dashboard-shell">
      <header className="dash-header">
        <div>
          <span className="brand-mark">RR</span>
          <span className="eyebrow">CONTROL ROOM</span>
          <h1>{channel}</h1>
        </div>
        <span className={`connection ${connection === "live" ? "online" : ""}`}>
          ● {connection}
        </span>
      </header>
      <div className="dash-grid">
        <section className="panel main-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">QUEST STATUS</span>
              <h2>{state?.title ?? "No active quest"}</h2>
            </div>
            <span
              className={`status-pill ${state?.status === "COMPLETED" ? "complete" : ""}`}
            >
              {state?.status ?? "IDLE"}
            </span>
          </div>
          {state ? (
            <>
              <div className="state-grid">
                <div>
                  <small>CANON NAME</small>
                  <b>
                    {state.canonName ??
                      (state.pendingName ? "Private review" : "Not approved")}
                  </b>
                </div>
                <div>
                  <small>CURRENT CHANNEL</small>
                  <b>{state.currentChannelId}</b>
                </div>
                <div>
                  <small>PARTY SIZE</small>
                  <b>
                    {state.partySize === null
                      ? "—"
                      : `${state.partySize} · ${state.partyTier}`}
                  </b>
                </div>
                <div>
                  <small>DEADLINE</small>
                  <b>{formatRemaining(state.deadlineAt) || "—"}</b>
                </div>
              </div>
              {state.status === "NAME_PENDING_APPROVAL" && (
                <div className="private-review">
                  <div>
                    <span className="eyebrow">PRIVATE NAME REVIEW</span>
                    <h3>Pending: {state.pendingName ?? "the Ember Fox"}</h3>
                  </div>
                  <div className="candidate actions">
                    {button(
                      "Approve pending name",
                      `/api/quests/${encodeURIComponent(state.id)}/name/approve`,
                      {},
                      true,
                    )}
                    {button(
                      "Veto and review next",
                      `/api/quests/${encodeURIComponent(state.id)}/name/veto`,
                    )}
                  </div>
                  <h4>Ranked candidates</h4>
                  {snapshot?.candidates?.length ? (
                    snapshot.candidates.map((candidate) => (
                      <div
                        className="candidate read-only"
                        key={candidate.normalizedName}
                      >
                        <div>
                          <b>{candidate.displayName}</b>
                          <small>
                            {candidate.supportCount} support
                            {candidate.supportCount === 1 ? "" : "s"}
                          </small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p>
                      No eligible proposals. Approving selects the safe default.
                    </p>
                  )}
                </div>
              )}
              {tally &&
                (state.status === "BEAT1_VOTING" ||
                  state.status === "BEAT2_VOTING" ||
                  state.status === "COMPLETED") && (
                  <div className="tally-summary">
                    <span>{tally.votes} valid votes</span>
                    <b>Incoming party {tally.raider}</b>
                    <b>Locals {tally.local}</b>
                  </div>
                )}
              <div className="actions">
                {state?.status === "DRAFT" &&
                  button(
                    "Open naming",
                    `/api/quests/${state.id}/naming/open`,
                    undefined,
                    true,
                  )}
                {state?.status === "HANDOFF_OFFERED" &&
                  button(
                    "Accept handoff",
                    "/api/handoff/accept",
                    { questId: state.id },
                    true,
                  )}
                {state?.status === "HANDOFF_OFFERED" &&
                  button("Dismiss handoff", "/api/handoff/dismiss", {
                    questId: state.id,
                  })}
                {state?.status === "WELCOME" &&
                  button(
                    "Open beat 2 voting",
                    `/api/quests/${state.id}/voting/open`,
                    undefined,
                    true,
                  )}
                {(state?.status === "BEAT1_VOTING" ||
                  state?.status === "BEAT2_VOTING") &&
                  button(
                    "Close voting now",
                    `/api/quests/${state.id}/voting/close`,
                  )}
                {state &&
                  state.pausedAt === null &&
                  !["COMPLETED", "HANDOFF_DISMISSED"].includes(state.status) &&
                  button("Pause", "/api/pause", { questId: state.id })}
                {state &&
                  state.pausedAt !== null &&
                  button("Resume", "/api/resume", { questId: state.id }, true)}
                {state &&
                  ["COMPLETED", "HANDOFF_DISMISSED"].includes(state.status) &&
                  button(
                    "Start another quest",
                    "/api/quests",
                    { channelId: channel },
                    true,
                  )}
                {snapshot?.demoMode &&
                  state &&
                  ["COMPLETED", "HANDOFF_DISMISSED"].includes(state.status) &&
                  button(
                    "Run full demo",
                    "/api/demo/run",
                    { channelId: channel },
                    true,
                  )}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <p>Create a quest to begin the story in this channel.</p>
              {button(
                "Start quest",
                "/api/quests",
                { channelId: channel },
                true,
              )}
              {snapshot?.demoMode &&
                button(
                  "Run full demo",
                  "/api/demo/run",
                  { channelId: channel },
                  true,
                )}
            </div>
          )}
          {snapshot?.simulated && (
            <span className="simulated inline">SIMULATED INPUT SEEN</span>
          )}
          {message && (
            <p className="toast" role="status">
              {message}
            </p>
          )}
        </section>
        <aside className="panel side-panel">
          <span className="eyebrow">CONNECTION HEALTH</span>
          <h2>{snapshot?.twitch?.status ?? "Waiting for state"}</h2>
          <p>
            WebSocket: <b>{connection}</b>
          </p>
          <p>
            Last chat:{" "}
            {snapshot?.twitch?.lastChatAt
              ? new Date(snapshot.twitch.lastChatAt).toLocaleTimeString()
              : "—"}
          </p>
          <p>
            Last raid:{" "}
            {snapshot?.twitch?.lastRaidAt
              ? new Date(snapshot.twitch.lastRaidAt).toLocaleTimeString()
              : "—"}
          </p>
          {snapshot?.recap && (
            <p>Recap source: {snapshot.recap.recap_source}</p>
          )}
          {snapshot?.simulated && <span className="simulated">SIMULATED</span>}
          <div className="event-tail">
            <span className="eyebrow">EVENT LOG</span>
            {snapshot?.chainEvents
              ?.slice(-8)
              .reverse()
              .map((event) => (
                <div className="event" key={event.sequence}>
                  <b>{event.type}</b>
                  <time>{new Date(event.at).toLocaleTimeString()}</time>
                </div>
              )) ?? <p>No events yet.</p>}
          </div>
        </aside>
      </div>
      <footer className="dash-footer">
        Overlay:{" "}
        {overlayKey ? (
          <a
            href={`/overlay/${encodeURIComponent(channel)}?key=${encodeURIComponent(overlayKey)}`}
            target="_blank"
          >
            open preview
          </a>
        ) : (
          <span>
            pass <code>overlayKey</code> in this dashboard URL to enable preview
          </span>
        )}{" "}
        · <a href="/chain">Story chain</a>
      </footer>
    </main>
  );
}

function ChainPage({ questId }: { questId?: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const url = questId
      ? `/api/chain/${encodeURIComponent(questId)}`
      : "/api/chain";
    void fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error("Story not found");
        return response.json() as Promise<Record<string, unknown>>;
      })
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Unable to load story"),
      );
  }, [questId]);
  const items = useMemo(
    () =>
      Array.isArray(data?.events)
        ? (data.events as Array<{
            sequence: number;
            type: string;
            at: number;
            data: Record<string, unknown>;
          }>)
        : [],
    [data],
  );
  return (
    <main className="chain-shell">
      <header>
        <span className="brand-mark">RR</span>
        <span className="eyebrow">PUBLIC STORY CHAIN</span>
        <h1>{String(data?.title ?? "Stories from the road")}</h1>
      </header>
      {error && <p>{error}</p>}
      {Array.isArray(data) ? (
        <div className="chain-list">
          {(data as Array<Record<string, unknown>>).map((item) => (
            <a
              className="chain-item"
              href={`/chain/${String(item.questId)}`}
              key={String(item.questId)}
            >
              <span>{String(item.title)}</span>
              <b>{String(item.canonName ?? "Name pending")}</b>
              <small>
                {String(item.status)} · {String(item.channelId)} · Updated{" "}
                {new Date(Number(item.updatedAt)).toLocaleString()}
              </small>
            </a>
          ))}
        </div>
      ) : (
        <>
          {questId && (
            <>
              <p className="chain-objective">
                {String(data?.objective ?? "Recorded from persisted events.")}
              </p>
              {data?.canonName && (
                <p className="chain-objective">
                  Canon: {String(data.canonName)} · Party size:{" "}
                  {data.partySize === null
                    ? "unavailable"
                    : String(data.partySize)}{" "}
                  · {String(data.partyTier ?? "tier pending")}
                </p>
              )}
            </>
          )}
          <div className="timeline">
            {items.map((event) => (
              <article className="timeline-item" key={event.sequence}>
                <span className="timeline-dot" />
                <time>{new Date(event.at).toLocaleString()}</time>
                <h2>{event.type.replaceAll(".", " ")}</h2>
                <ChainEventText event={event} />
              </article>
            ))}
          </div>
        </>
      )}
      <footer>Recorded from persisted events.</footer>
    </main>
  );
}

function ChainEventText({
  event,
}: {
  event: { type: string; data: Record<string, unknown> };
}) {
  const d = event.data;
  if (event.type === "raid.received")
    return (
      <p>
        {String(d.sourceChannelId)} raided {String(d.targetChannelId)} ·{" "}
        {d.viewers === null
          ? "size unavailable"
          : `${String(d.viewers)} viewers`}{" "}
        · {String(d.partyTier)} party
      </p>
    );
  if (event.type === "name.approved" || event.type === "name.default_selected")
    return <p>Canon name: {String(d.canonName)}</p>;
  if (event.type.endsWith("resolved")) {
    const resolution = d.resolution as
      | {
          choice?: string;
          raw?: Record<string, { raider: number; local: number }>;
        }
      | undefined;
    const outcome = d.outcome as { text?: string } | undefined;
    return (
      <>
        <p>Decision: {String(resolution?.choice ?? "recorded")}</p>
        {resolution?.raw && (
          <p>
            Raw votes — Incoming party / Locals:{" "}
            {Object.entries(resolution.raw)
              .map(
                ([choice, counts]) =>
                  `${choice} ${counts.raider}/${counts.local}`,
              )
              .join(" · ")}
          </p>
        )}
        {outcome?.text && <p>{outcome.text}</p>}
      </>
    );
  }
  if (event.type === "handoff.accepted" || event.type === "handoff.dismissed")
    return (
      <p>
        {String(d.sourceChannelId)} → {String(d.targetChannelId)}
      </p>
    );
  return <p>The story record was updated.</p>;
}

function App() {
  if (route === "overlay") return <Overlay />;
  if (route === "dashboard")
    return token ? (
      <Dashboard />
    ) : (
      <main className="dashboard-shell">
        <h1>Dashboard token required</h1>
        <p>
          Open this route with <code>?token=…</code>.
        </p>
      </main>
    );
  if (route === "chain")
    return pathParts[1] ? <ChainPage questId={pathParts[1]} /> : <ChainPage />;
  return (
    <main className="dashboard-shell">
      <h1>Raid Relay</h1>
      <p>
        Open <code>/dashboard/{channel}?token=…</code> or{" "}
        <code>/overlay/{channel}?key=…</code>.
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
