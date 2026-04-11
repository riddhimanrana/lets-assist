#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const accounts = [
  {
    email: "riddhiman.rana@gmail.com",
    password: "robo6737",
    fullName: "Riddhiman Rana",
    username: "riddhimanrana",
    isAdmin: true,
  },
  {
    email: "jane.doe@example.com",
    password: "password123",
    fullName: "Jane Doe",
    username: "jane-doe",
    isAdmin: false,
  },
  {
    email: "john.smith@example.com",
    password: "password123",
    fullName: "John Smith",
    username: "john-smith",
    isAdmin: false,
  },
  {
    email: "alex.trusted@example.com",
    password: "password123",
    fullName: "Alex Trusted",
    username: "alex-trusted",
    isAdmin: false,
  },
  {
    email: "minimal.user@example.com",
    password: "password123",
    fullName: "Minimal User",
    username: "minimal-user",
    isAdmin: false,
  },
  {
    email: "org.admin@example.com",
    password: "TestPass123!",
    fullName: "Org Admin",
    username: "org-admin",
    isAdmin: false,
  },
  {
    email: "trusted.reviewer@example.com",
    password: "TestPass123!",
    fullName: "Trusted Reviewer",
    username: "trusted-reviewer",
    isAdmin: false,
  },
  {
    email: "regular.member@example.com",
    password: "TestPass123!",
    fullName: "Regular Member",
    username: "regular-member",
    isAdmin: false,
  },
];

for (const account of accounts) {
  console.log(`[bootstrap-dev-accounts] Bootstrapping ${account.email}...`);

  execFileSync("node", ["scripts/local-dev/bootstrap-auth-user.mjs"], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: {
      ...process.env,
      DEV_BOOTSTRAP_EMAIL: account.email,
      DEV_BOOTSTRAP_PASSWORD: account.password,
      DEV_BOOTSTRAP_FULL_NAME: account.fullName,
      DEV_BOOTSTRAP_USERNAME: account.username,
      DEV_BOOTSTRAP_IS_ADMIN: String(account.isAdmin),
    },
  });
}

console.log("[bootstrap-dev-accounts] Done.");
