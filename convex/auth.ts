import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { APIError } from "better-auth/api";
import { internal } from "./_generated/api";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

export const authComponent = createClient<DataModel>(components.betterAuth);
export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    appName: "Ripple",
    baseURL: process.env.CONVEX_SITE_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [process.env.SITE_URL!],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: false,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      storage: "database",
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    user: { deleteUser: { enabled: true } },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const name = user.name
              .replace(/[\u0000-\u001f\u007f]/g, "")
              .trim()
              .replace(/\s+/g, " ");
            if (name.length < 2 || name.length > 24)
              throw new APIError("BAD_REQUEST", {
                message: "Use 2 to 24 characters for your display name.",
              });
            return { data: { ...user, name } };
          },
        },
        delete: {
          after: async (user) => {
            if ("runMutation" in ctx)
              await ctx.runMutation(internal.leaderboard.removeUser, {
                userId: user.id,
              });
          },
        },
      },
    },
    plugins: [
      crossDomain({ siteUrl: process.env.SITE_URL! }),
      convex({ authConfig }),
    ],
  });
