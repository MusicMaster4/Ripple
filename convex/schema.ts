import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  runs: defineTable({
    token: v.string(),
    finished: v.boolean(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    rulesVersion: v.optional(v.number()),
  }).index("by_token", ["token"]),
  scores: defineTable({
    userId: v.string(),
    name: v.string(),
    score: v.number(),
    clicks: v.number(),
    milliseconds: v.number(),
    achievedAt: v.number(),
    rulesVersion: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_score", ["rulesVersion", "score", "achievedAt"]),
});
