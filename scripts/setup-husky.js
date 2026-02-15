#!/usr/bin/env node

/**
 * Husky Setup Script - Latest Version (2025+)
 * Ensures Husky is properly configured with the modern approach
 */

import { execSync } from "child_process";
import { existsSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";

const HOOKS = {
  "pre-commit": "npm run pre-commit",
  "pre-push": "npm run pre-push",
  "commit-msg": "npx --no -- commitlint --edit $1",
};

function setupHusky() {
  console.log("🐕 Setting up Husky with latest configuration...\n");

  try {
    // 1. Install Husky
    console.log("📦 Installing Husky...");
    execSync("npm install husky --save-dev", { stdio: "inherit" });

    // 2. Initialize Husky
    console.log("🔧 Initializing Husky...");
    execSync("npx husky", { stdio: "inherit" });

    // 3. Create hook files
    console.log("📝 Creating hook files...");

    Object.entries(HOOKS).forEach(([hookName, command]) => {
      const hookPath = join(".husky", hookName);

      console.log(`   Creating ${hookName}...`);
      writeFileSync(hookPath, command);

      // Make executable (Unix/Linux/macOS)
      if (process.platform !== "win32") {
        try {
          chmodSync(hookPath, "755");
        } catch (error) {
          console.warn(`   ⚠️  Could not make ${hookName} executable:`, error.message);
        }
      }
    });

    // 4. Verify setup
    console.log("\n✅ Husky setup completed successfully!");
    console.log("\n📋 Configured hooks:");
    Object.keys(HOOKS).forEach((hook) => {
      const hookPath = join(".husky", hook);
      const exists = existsSync(hookPath);
      console.log(`   ${exists ? "✅" : "❌"} ${hook}`);
    });

    console.log("\n🎯 Next steps:");
    console.log("   • Hooks will run automatically on git operations");
    console.log("   • pre-commit: Runs lint-staged (ESLint + Prettier)");
    console.log("   • pre-push: Runs linting and tests");
    console.log("   • commit-msg: Validates commit message format");
  } catch (error) {
    console.error("❌ Husky setup failed:", error.message);
    process.exit(1);
  }
}

// Run setup
setupHusky();
