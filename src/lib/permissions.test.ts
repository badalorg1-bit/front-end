import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLES,
  ADMIN_ROLE_LABEL,
  ADMIN_ROLE_RANK,
  PERMISSIONS,
  PERMISSION_LABEL,
  ROLE_PERMISSIONS,
  canEditRolePermission,
  isStaffRole,
  roleHasPermission,
  type AdminRole,
  type Permission,
} from "@/lib/types";

/** Counts of the 49 seeded role_permissions rows (0034 §5). */
const SEEDED_COUNTS: Record<AdminRole, number> = {
  user: 0,
  merchant: 0,
  support: 3,
  operations: 3,
  moderator: 8,
  admin: 11,
  super_admin: 12,
  owner: 12,
};

describe("ADMIN_ROLES / labels / ranks (0034)", () => {
  it("lists exactly the eight roles in rank order", () => {
    expect([...ADMIN_ROLES]).toEqual([
      "user",
      "merchant",
      "support",
      "operations",
      "moderator",
      "admin",
      "super_admin",
      "owner",
    ]);
  });

  it("labels every role in Arabic, with no duplicates", () => {
    const labels = ADMIN_ROLES.map((r) => ADMIN_ROLE_LABEL[r]);
    for (const label of labels) expect(label).toBeTruthy();
    expect(new Set(labels).size).toBe(ADMIN_ROLES.length);
  });

  it("ranks roles on the server's app_role_rank scale", () => {
    expect(ADMIN_ROLE_RANK).toEqual({
      user: 0,
      merchant: 0,
      support: 1,
      operations: 1,
      moderator: 2,
      admin: 3,
      super_admin: 4,
      owner: 5,
    });
  });

  it("keeps the original four-role order so old thresholds still hold", () => {
    expect(ADMIN_ROLE_RANK.user).toBeLessThan(ADMIN_ROLE_RANK.moderator);
    expect(ADMIN_ROLE_RANK.moderator).toBeLessThan(ADMIN_ROLE_RANK.admin);
    expect(ADMIN_ROLE_RANK.admin).toBeLessThan(ADMIN_ROLE_RANK.super_admin);
  });

  it("is monotonically non-decreasing across the ordered list (tie ranks only)", () => {
    for (let i = 1; i < ADMIN_ROLES.length; i += 1) {
      expect(ADMIN_ROLE_RANK[ADMIN_ROLES[i]]).toBeGreaterThanOrEqual(
        ADMIN_ROLE_RANK[ADMIN_ROLES[i - 1]],
      );
    }
  });
});

describe("PERMISSIONS (0034 · twelve cells per role)", () => {
  it("lists exactly the twelve permissions", () => {
    expect(PERMISSIONS).toHaveLength(12);
    expect([...PERMISSIONS]).toEqual([
      "reports.view",
      "listings.review",
      "requests.view",
      "complaints.view",
      "complaints.manage",
      "disputes.manage",
      "delivery.manage",
      "notifications.broadcast",
      "users.manage",
      "settings.manage",
      "audit.view",
      "permissions.manage",
    ]);
  });

  it("labels every permission in Arabic, with no duplicates", () => {
    const labels = PERMISSIONS.map((p) => PERMISSION_LABEL[p]);
    for (const label of labels) expect(label).toBeTruthy();
    expect(new Set(labels).size).toBe(PERMISSIONS.length);
  });
});

describe("ROLE_PERMISSIONS seed mirror (0034 §5)", () => {
  it("matches the 49 seeded row counts, role by role", () => {
    let total = 0;
    for (const role of ADMIN_ROLES) {
      expect(ROLE_PERMISSIONS[role]).toHaveLength(SEEDED_COUNTS[role]);
      total += ROLE_PERMISSIONS[role].length;
    }
    expect(total).toBe(49);
  });

  it("grants no permission to the two end-user accounts", () => {
    expect(ROLE_PERMISSIONS.user).toEqual([]);
    expect(ROLE_PERMISSIONS.merchant).toEqual([]);
  });

  it("uses every permission at least once (the matrix has no dead column)", () => {
    const used = new Set<string>();
    for (const role of ADMIN_ROLES) for (const p of ROLE_PERMISSIONS[role]) used.add(p);
    expect([...used].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("never repeats a permission inside one role", () => {
    for (const role of ADMIN_ROLES) {
      const list = ROLE_PERMISSIONS[role];
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("only ever holds declared permissions", () => {
    const declared = new Set<string>(PERMISSIONS);
    for (const role of ADMIN_ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(declared.has(p)).toBe(true);
    }
  });

  it("is monotone across strictly increasing ranks (no lower-rank permission is lost upward)", () => {
    for (const lower of ADMIN_ROLES) {
      for (const higher of ADMIN_ROLES) {
        if (ADMIN_ROLE_RANK[higher] <= ADMIN_ROLE_RANK[lower]) continue;
        const held = new Set<string>(ROLE_PERMISSIONS[higher]);
        for (const p of ROLE_PERMISSIONS[lower]) expect(held.has(p)).toBe(true);
      }
    }
  });

  it("gives permissions.manage only to super_admin and owner", () => {
    const holders = ADMIN_ROLES.filter((r) => roleHasPermission(r, "permissions.manage"));
    expect(holders).toEqual(["super_admin", "owner"]);
  });
});

describe("isStaffRole", () => {
  it("excludes the two end-user accounts (incl. merchant)", () => {
    expect(isStaffRole("user")).toBe(false);
    expect(isStaffRole("merchant")).toBe(false);
  });

  it("includes every back-office role", () => {
    for (const role of ["support", "operations", "moderator", "admin", "super_admin", "owner"] as const) {
      expect(isStaffRole(role)).toBe(true);
    }
  });
});

describe("roleHasPermission", () => {
  it("returns false for a missing role", () => {
    expect(roleHasPermission(null, "reports.view")).toBe(false);
    expect(roleHasPermission(undefined, "reports.view")).toBe(false);
  });

  it("returns false for an end-user account", () => {
    expect(roleHasPermission("user", "reports.view")).toBe(false);
    expect(roleHasPermission("merchant", "requests.view")).toBe(false);
  });

  it("mirrors the seed for a mid tier (support)", () => {
    expect(roleHasPermission("support", "requests.view")).toBe(true);
    expect(roleHasPermission("support", "complaints.manage")).toBe(true);
    expect(roleHasPermission("support", "reports.view")).toBe(false);
    expect(roleHasPermission("support", "permissions.manage")).toBe(false);
  });

  it("grants everything to super_admin and owner", () => {
    for (const p of PERMISSIONS) {
      expect(roleHasPermission("super_admin", p)).toBe(true);
      expect(roleHasPermission("owner", p)).toBe(true);
    }
  });

  it("covers the full role × permission grid (96 cells) without a hole", () => {
    let granted = 0;
    for (const role of ADMIN_ROLES) {
      for (const p of PERMISSIONS) {
        const expected = ROLE_PERMISSIONS[role].includes(p);
        expect(roleHasPermission(role, p)).toBe(expected);
        if (expected) granted += 1;
      }
    }
    expect(granted).toBe(49);
  });
});

describe("canEditRolePermission (mirror of admin_set_role_permission gates)", () => {
  it("refuses a missing actor role", () => {
    expect(canEditRolePermission(null, "user")).toBe(false);
    expect(canEditRolePermission(undefined, "admin")).toBe(false);
  });

  it("refuses actors without permissions.manage", () => {
    for (const actor of ["user", "merchant", "support", "operations", "moderator", "admin"] as const) {
      expect(canEditRolePermission(actor, "user")).toBe(false);
    }
  });

  it("refuses editing your own role", () => {
    expect(canEditRolePermission("super_admin", "super_admin")).toBe(false);
    expect(canEditRolePermission("owner", "owner")).toBe(false);
  });

  it("refuses editing a role of equal or higher rank", () => {
    // super_admin (4) may not touch owner (5).
    expect(canEditRolePermission("super_admin", "owner")).toBe(false);
  });

  it("allows editing strictly lower ranks", () => {
    expect(canEditRolePermission("super_admin", "admin")).toBe(true);
    expect(canEditRolePermission("super_admin", "user")).toBe(true);
    expect(canEditRolePermission("owner", "super_admin")).toBe(true);
    expect(canEditRolePermission("owner", "user")).toBe(true);
  });

  it("never grants an edit the actor's own rank could not hold", () => {
    // Every allowed target must sit strictly below the actor on the rank scale.
    for (const actor of ADMIN_ROLES) {
      for (const target of ADMIN_ROLES) {
        if (!canEditRolePermission(actor, target)) continue;
        expect(ADMIN_ROLE_RANK[target]).toBeLessThan(ADMIN_ROLE_RANK[actor]);
        expect(actor).not.toBe(target);
        expect(roleHasPermission(actor, "permissions.manage")).toBe(true);
      }
    }
  });
});

describe("declared types stay in sync with the constants", () => {
  it("exposes one Permission per matrix column", () => {
    const columns: Permission[] = [...PERMISSIONS];
    expect(columns).toHaveLength(PERMISSIONS.length);
  });

  it("exposes one label per role", () => {
    const rows: AdminRole[] = [...ADMIN_ROLES];
    for (const role of rows) expect(ADMIN_ROLE_LABEL[role]).toBeTruthy();
  });
});
