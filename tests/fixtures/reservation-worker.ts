import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { z } from "zod";
import { ReservePurchaseSchema } from "../../src/shared/contracts/purchase-order.ts";
import { createPurchaseStore } from "../../src/main/infrastructure/storage/purchase-store.ts";
import { PurchaseError } from "../../src/main/domain/purchase-error.ts";

const path = z.string().min(1).parse(process.argv[2]);
const database = new Database(path);
database.pragma("busy_timeout = 5000");
database.pragma("foreign_keys = ON");
const purchases = createPurchaseStore(database, drizzle(database));
process.once("message", (input: unknown) => {
  try {
    purchases.reserve(ReservePurchaseSchema.parse(input));
    process.send?.({ status: "reserved" });
  } catch (error) {
    process.send?.({
      status: "rejected",
      code: error instanceof PurchaseError ? error.code : "unexpected",
    });
  } finally {
    database.close();
    process.disconnect();
  }
});
process.send?.({ status: "ready" });
