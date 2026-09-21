import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  auditLogs,
  banners,
  coupons,
  featureFlags,
  notificationTemplates,
  promotions,
  reviews,
  users,
} from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { PermissionKey } from '@/modules/identity';

export interface OperationSnapshot {
  summary: Array<{ label: string; value: number }>;
  rows: Array<Record<string, unknown>>;
}

export async function updateAdminOperation(
  permission: PermissionKey,
  id: string,
  action: string,
  actorUserId: string
) {
  const db = await getDb();
  let entityType: string = permission;
  await db.transaction(async (tx) => {
    switch (permission) {
      case 'review:moderate':
        entityType = 'review';
        await tx
          .update(reviews)
          .set({
            status: action === 'approve' ? 'APPROVED' : 'REJECTED',
            moderatedBy: actorUserId,
            moderatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(reviews.id, id));
        break;
      case 'coupon:manage':
        entityType = 'coupon';
        await tx
          .update(coupons)
          .set({ isActive: action === 'enable', updatedAt: new Date() })
          .where(eq(coupons.id, id));
        break;
      case 'promotion:manage':
        entityType = 'promotion';
        await tx
          .update(promotions)
          .set({ isActive: action === 'enable', updatedAt: new Date() })
          .where(eq(promotions.id, id));
        break;
      case 'banner:manage':
        entityType = 'banner';
        await tx
          .update(banners)
          .set({ isActive: action === 'enable', updatedAt: new Date() })
          .where(eq(banners.id, id));
        break;
      case 'template:manage':
        entityType = 'notification_template';
        await tx
          .update(notificationTemplates)
          .set({ isActive: action === 'enable', updatedBy: actorUserId, updatedAt: new Date() })
          .where(eq(notificationTemplates.id, id));
        break;
      case 'flag:manage':
        entityType = 'feature_flag';
        await tx
          .update(featureFlags)
          .set({
            isEnabled: action === 'enable',
            rolloutPercentage: action === 'enable' ? 100 : 0,
            updatedBy: actorUserId,
            updatedAt: new Date(),
          })
          .where(eq(featureFlags.id, id));
        break;
      case 'admin_user:manage':
        entityType = 'user';
        await tx
          .update(users)
          .set({ status: action === 'enable' ? 'ACTIVE' : 'SUSPENDED', updatedAt: new Date() })
          .where(eq(users.id, id));
        break;
      default:
        throw new Error('This operation is read-only.');
    }
    await tx
      .insert(auditLogs)
      .values({
        actorUserId,
        actorRole: 'SUPER_ADMIN',
        action: 'UPDATE',
        entityType,
        entityId: id,
        changedFields: [action],
        reason: 'Admin dashboard operation',
      });
  });
}

export async function readAdminOperation(permission: PermissionKey): Promise<OperationSnapshot> {
  const db = await getDb();
  const query = queryFor(permission);
  const result = await db.execute(query);
  const rows = Array.from(result as Iterable<Record<string, unknown>>);
  return { summary: [{ label: 'Records', value: rows.length }], rows };
}

function queryFor(permission: PermissionKey) {
  switch (permission) {
    case 'analytics:view':
    case 'report:view':
      return sql`select date_trunc('day', created_at)::text as period, count(*)::int as orders,
        coalesce(sum(grand_total_paise), 0)::bigint as gmv_paise
        from orders group by 1 order by 1 desc limit 30`;
    case 'review:moderate':
      return sql`select id, rating, title, status, is_verified_purchase, created_at from reviews where deleted_at is null order by created_at desc limit 100`;
    case 'coupon:manage':
      return sql`select id, code, coupon_type, discount_value, min_cart_paise, used_count, is_active, valid_until from coupons where deleted_at is null order by created_at desc limit 100`;
    case 'promotion:manage':
      return sql`select id, name, promotion_type, priority, is_active, valid_from, valid_until from promotions where deleted_at is null order by priority desc, created_at desc limit 100`;
    case 'banner:manage':
      return sql`select id, placement, target_audience, priority, is_active, starts_at, ends_at, impression_count, click_count from banners where deleted_at is null order by priority desc limit 100`;
    case 'notification:manage':
      return sql`select id, event_key, channel, title, status, sent_at, delivered_at, created_at from notifications order by created_at desc limit 100`;
    case 'template:manage':
      return sql`select id, event_key, channel, locale, subject, is_active, version, updated_at from notification_templates order by updated_at desc limit 100`;
    case 'cms:manage':
      return sql`select id, slug, page_type, status, published_at, updated_at from cms_pages where deleted_at is null order by updated_at desc limit 100`;
    case 'setting:view':
    case 'setting:manage':
    case 'setting:manage_sensitive':
      return sql`select id, key, group_name, label, value_type, is_sensitive,
        case when is_sensitive then '••••••••'::jsonb else value end as value, updated_at
        from admin_settings order by group_name, key limit 200`;
    case 'role:manage':
      return sql`select r.id, r.key, r.name, r.is_system, count(rp.permission_id)::int as permissions
        from roles r left join role_permissions rp on rp.role_id = r.id group by r.id order by r.name`;
    case 'admin_user:manage':
      return sql`select u.id, u.full_name, u.phone, u.status, u.preferred_locale, u.created_at,
        coalesce(string_agg(distinct r.key::text, ', '), '') as roles
        from users u left join user_roles ur on ur.user_id = u.id and ur.revoked_at is null
        left join roles r on r.id = ur.role_id group by u.id order by u.created_at desc limit 200`;
    case 'audit:view':
      return sql`select id, actor_role, action, entity_type, entity_id, reason, request_id, created_at from audit_logs order by created_at desc limit 200`;
    case 'flag:manage':
      return sql`select id, key, description, is_enabled, rollout_percentage, updated_at from feature_flags order by key`;
    default:
      return sql`select id, event_type, severity, source, message, resolved_at, created_at from system_events order by created_at desc limit 100`;
  }
}
