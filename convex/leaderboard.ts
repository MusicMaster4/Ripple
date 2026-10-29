import { mutation, query, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { authComponent } from "./auth";
import { replay, validateBounds, RULES_VERSION } from "../src/game/engine";

export const begin = mutation({
  args: { token: v.string(), width: v.number(), height: v.number() },
  handler: async (ctx, { token, width, height }) => {
    try {
      validateBounds({ width, height });
    } catch {
      throw new ConvexError("Invalid arena size.");
    }
    if (!/^[0-9a-f-]{36}$/.test(token)) throw new ConvexError("Invalid run.");
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (existing) {
      if (
        existing.width !== width ||
        existing.height !== height ||
        existing.rulesVersion !== RULES_VERSION
      )
        throw new ConvexError("Invalid run.");
      return;
    }
    await ctx.db.insert("runs", {
      token,
      finished: false,
      width,
      height,
      rulesVersion: RULES_VERSION,
    });
  },
});

export const submit = mutation({
  args: {
    token: v.string(),
    moves: v.array(v.object({ x: v.number(), y: v.number(), t: v.number() })),
  },
  handler: async (ctx, { token, moves }) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError("Sign in to save your score.");
    const ticket = await ctx.db
      .query("runs")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (
      !ticket ||
      ticket.width === undefined ||
      ticket.height === undefined ||
      ticket.rulesVersion !== RULES_VERSION ||
      ticket.finished ||
      Date.now() - ticket._creationTime > 15 * 60_000
    )
      throw new ConvexError("This run has expired. Play again.");
    let game;
    try {
      game = replay(moves, { width: ticket.width, height: ticket.height });
    } catch {
      throw new ConvexError("This run could not be verified. Play again.");
    }
    if (game.time > Date.now() - ticket._creationTime + 5000)
      throw new ConvexError("This run could not be verified.");
    await ctx.db.patch(ticket._id, { finished: true });
    const existing = await ctx.db
      .query("scores")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (
      existing &&
      existing.rulesVersion === RULES_VERSION &&
      existing.score >= game.score
    )
      return { personalBest: false };
    const name =
      user.name
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 24) || "A quiet ripple";
    const row = {
      userId: user._id,
      name,
      score: game.score,
      clicks: game.clicks,
      milliseconds: Math.round(game.time),
      achievedAt: Date.now(),
      rulesVersion: RULES_VERSION,
    };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("scores", row);
    return { personalBest: true };
  },
});

export const board = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError("Sign in to see the leaderboard.");
    const rows = await ctx.db
      .query("scores")
      .withIndex("by_score", (q) => q.eq("rulesVersion", RULES_VERSION))
      .order("desc")
      .take(100);
    const mine = await ctx.db
      .query("scores")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    const safe = (row: (typeof rows)[number]) => ({
      id: row._id,
      name: row.name,
      score: row.score,
      clicks: row.clicks,
      milliseconds: row.milliseconds,
      isYou: row.userId === user._id,
    });
    return {
      rows: rows.map(safe),
      mine: mine?.rulesVersion === RULES_VERSION ? safe(mine) : null,
    };
  },
});

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("runs")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - 24 * 60 * 60_000),
      )
      .take(500);
    for (const row of old) await ctx.db.delete(row._id);
  },
});

// Deleting an auth account must also remove its public leaderboard entry.
export const removeUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("scores")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});
