import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const remoteRelations = defineRelations(schema, (r) => ({
  user: {
    sessions: r.many.session(),
    accounts: r.many.account(),
    memberships: r.many.member(),
    invitations: r.many.invitation(),
  },
  session: {
    user: r.one.user({
      from: r.session.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  account: {
    user: r.one.user({
      from: r.account.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  organization: {
    members: r.many.member(),
    invitations: r.many.invitation(),
  },
  member: {
    organization: r.one.organization({
      from: r.member.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    user: r.one.user({
      from: r.member.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  invitation: {
    organization: r.one.organization({
      from: r.invitation.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    inviter: r.one.user({
      from: r.invitation.inviterId,
      to: r.user.id,
      optional: false,
    }),
  },
  categories: {
    products: r.many.products(),
  },
  products: {
    category: r.one.categories({
      from: [r.products.organizationId, r.products.categoryId],
      to: [r.categories.organizationId, r.categories.id],
      optional: false,
    }),
    batches: r.many.batches(),
    stockMovements: r.many.stockMovements(),
  },
  batches: {
    product: r.one.products({
      from: [r.batches.organizationId, r.batches.productId],
      to: [r.products.organizationId, r.products.id],
      optional: false,
    }),
    stockMovements: r.many.stockMovements(),
  },
  invoices: {
    items: r.many.invoiceItems(),
    stockMovements: r.many.stockMovements(),
  },
  invoiceItems: {
    invoice: r.one.invoices({
      from: [r.invoiceItems.organizationId, r.invoiceItems.invoiceId],
      to: [r.invoices.organizationId, r.invoices.id],
      optional: false,
    }),
    product: r.one.products({
      from: [r.invoiceItems.organizationId, r.invoiceItems.productId],
      to: [r.products.organizationId, r.products.id],
      optional: false,
    }),
    batch: r.one.batches({
      from: [r.invoiceItems.organizationId, r.invoiceItems.batchId],
      to: [r.batches.organizationId, r.batches.id],
      optional: false,
    }),
  },
  stockMovements: {
    product: r.one.products({
      from: [r.stockMovements.organizationId, r.stockMovements.productId],
      to: [r.products.organizationId, r.products.id],
      optional: false,
    }),
    batch: r.one.batches({
      from: [r.stockMovements.organizationId, r.stockMovements.batchId],
      to: [r.batches.organizationId, r.batches.id],
      optional: false,
    }),
    invoice: r.one.invoices({
      from: [r.stockMovements.organizationId, r.stockMovements.invoiceId],
      to: [r.invoices.organizationId, r.invoices.id],
      optional: true,
    }),
  },
}));
