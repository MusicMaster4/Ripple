import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval(
  "Remove expired run tickets",
  { hours: 1 },
  internal.leaderboard.cleanup,
);
export default crons;
