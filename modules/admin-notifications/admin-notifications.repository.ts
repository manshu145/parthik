import { and, desc, eq, isNull, max } from 'drizzle-orm';
import {
  auditLogs,
  customerNotificationPreferences,
  devices,
  notificationTemplates,
  notifications,
  users,
} from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { ConfigurationError, ConflictError, NotFoundError } from '@/lib/errors';
import { pushSender } from '@/lib/firebase/messaging';

export type ActiveNotificationChannel = 'PUSH' | 'IN_APP';
export type AdminNotificationCategory = 'ORDER' | 'PROMOTION' | 'ACCOUNT' | 'SUPPORT';

export interface AdminTemplateInput {
  eventKey: string;
  channel: ActiveNotificationChannel;
  locale: 'en' | 'hi';
  subject: string | null;
  body: string;
  variables: string[];
  isActive: boolean;
}

export interface AdminNotificationInput {
  userId: string;
  channel: ActiveNotificationChannel;
  category: AdminNotificationCategory;
  title: string;
  body: string;
  eventKey: string;
  data: Record<string, string>;
}

export async function listAdminNotifications(limit = 200) {
  const db = await getDb();
  return db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      userName: users.fullName,
      userPhone: users.phone,
      eventKey: notifications.eventKey,
      channel: notifications.channel,
      title: notifications.title,
      body: notifications.body,
      status: notifications.status,
      providerMessageId: notifications.providerMessageId,
      failureReason: notifications.failureReason,
      sentAt: notifications.sentAt,
      deliveredAt: notifications.deliveredAt,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function listAdminNotificationTemplates(limit = 300) {
  const db = await getDb();
  return db
    .select({
      id: notificationTemplates.id,
      eventKey: notificationTemplates.eventKey,
      channel: notificationTemplates.channel,
      locale: notificationTemplates.locale,
      subject: notificationTemplates.subject,
      body: notificationTemplates.body,
      variables: notificationTemplates.variables,
      isActive: notificationTemplates.isActive,
      version: notificationTemplates.version,
      updatedAt: notificationTemplates.updatedAt,
    })
    .from(notificationTemplates)
    .orderBy(
      notificationTemplates.eventKey,
      notificationTemplates.channel,
      notificationTemplates.locale,
      desc(notificationTemplates.version)
    )
    .limit(limit);
}

export async function createAdminNotificationTemplate(
  input: AdminTemplateInput,
  actorUserId: string
) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [versionRow] = await tx
      .select({ version: max(notificationTemplates.version) })
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.eventKey, input.eventKey),
          eq(notificationTemplates.channel, input.channel),
          eq(notificationTemplates.locale, input.locale)
        )
      );
    const version = Number(versionRow?.version ?? 0) + 1;

    if (input.isActive) {
      await tx
        .update(notificationTemplates)
        .set({ isActive: false, updatedBy: actorUserId, updatedAt: new Date() })
        .where(
          and(
            eq(notificationTemplates.eventKey, input.eventKey),
            eq(notificationTemplates.channel, input.channel),
            eq(notificationTemplates.locale, input.locale)
          )
        );
    }

    const [created] = await tx
      .insert(notificationTemplates)
      .values({
        eventKey: input.eventKey,
        channel: input.channel,
        locale: input.locale,
        subject: input.subject,
        body: input.body,
        variables: input.variables,
        isActive: input.isActive,
        version,
        updatedBy: actorUserId,
      })
      .returning({ id: notificationTemplates.id, version: notificationTemplates.version });

    if (!created) throw new ConflictError('Could not create notification template.');

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'CREATE',
      entityType: 'notification_template',
      entityId: created.id,
      after: {
        eventKey: input.eventKey,
        channel: input.channel,
        locale: input.locale,
        version,
        isActive: input.isActive,
      },
      changedFields: ['eventKey', 'channel', 'locale', 'subject', 'body', 'variables', 'isActive'],
      reason: 'Notification template version created',
    });

    return created;
  });
}

export async function reviseAdminNotificationTemplate(
  id: string,
  input: Pick<AdminTemplateInput, 'subject' | 'body' | 'variables' | 'isActive'>,
  actorUserId: string
) {
  const db = await getDb();
  const [current] = await db
    .select({
      eventKey: notificationTemplates.eventKey,
      channel: notificationTemplates.channel,
      locale: notificationTemplates.locale,
    })
    .from(notificationTemplates)
    .where(eq(notificationTemplates.id, id))
    .limit(1);

  if (!current) throw new NotFoundError('Notification template not found.');
  if (current.channel !== 'PUSH' && current.channel !== 'IN_APP') {
    throw new ConflictError('Only PUSH and IN_APP templates are active in V1.');
  }

  return createAdminNotificationTemplate(
    {
      eventKey: current.eventKey,
      channel: current.channel,
      locale: current.locale,
      ...input,
    },
    actorUserId
  );
}

export async function sendAdminNotification(input: AdminNotificationInput, actorUserId: string) {
  const db = await getDb();

  const [user] = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
    .limit(1);
  if (!user) throw new NotFoundError('Recipient user not found.');
  if (user.status !== 'ACTIVE') throw new ConflictError('Recipient account is not active.');

  if (input.category === 'PROMOTION') {
    const [preference] = await db
      .select({ enabled: customerNotificationPreferences.enabled })
      .from(customerNotificationPreferences)
      .where(
        and(
          eq(customerNotificationPreferences.userId, input.userId),
          eq(customerNotificationPreferences.channel, input.channel),
          eq(customerNotificationPreferences.category, 'PROMOTION')
        )
      )
      .limit(1);

    if (preference?.enabled === false) {
      throw new ConflictError('This user has opted out of promotional notifications.');
    }
  }

  if (input.channel === 'IN_APP') {
    const [created] = await db
      .insert(notifications)
      .values({
        userId: input.userId,
        eventKey: input.eventKey,
        channel: 'IN_APP',
        title: input.title,
        body: input.body,
        data: input.data,
        status: 'SENT',
        sentAt: new Date(),
      })
      .returning({ id: notifications.id });

    if (!created) throw new ConflictError('Could not create in-app notification.');
    await auditSend(created.id, input, actorUserId, 'SENT');
    return { id: created.id, status: 'SENT' as const, deviceCount: 0, successCount: 1 };
  }

  if (!pushSender.isConfigured()) {
    throw new ConfigurationError(
      'FCM is not configured. Add Firebase server credentials in Admin → Settings before sending push notifications.'
    );
  }

  const targetDevices = await db
    .select({
      id: devices.id,
      fcmToken: devices.fcmToken,
    })
    .from(devices)
    .where(
      and(
        eq(devices.userId, input.userId),
        eq(devices.pushPermission, 'GRANTED'),
        isNull(devices.revokedAt)
      )
    );

  const usable = targetDevices.filter((device): device is typeof device & { fcmToken: string } =>
    Boolean(device.fcmToken)
  );

  if (usable.length === 0) {
    throw new ConflictError('Recipient has no active device with push permission.');
  }

  const [created] = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      eventKey: input.eventKey,
      channel: 'PUSH',
      title: input.title,
      body: input.body,
      data: input.data,
      status: 'QUEUED',
    })
    .returning({ id: notifications.id });

  if (!created) throw new ConflictError('Could not queue push notification.');

  const results = await Promise.all(
    usable.map(async (device) => ({
      device,
      result: await pushSender.send({
        token: device.fcmToken,
        title: input.title,
        body: input.body,
        data: input.data,
      }),
    }))
  );

  const successful = results.filter((item) => item.result.success);
  const invalid = results.filter((item) => item.result.tokenInvalid);

  for (const item of invalid) {
    await db
      .update(devices)
      .set({ fcmToken: null, fcmTokenUpdatedAt: new Date() })
      .where(eq(devices.id, item.device.id));
  }

  const status = successful.length > 0 ? 'SENT' : 'FAILED';
  const firstMessageId = successful.find((item) => item.result.messageId)?.result.messageId ?? null;
  const failureReason =
    successful.length > 0
      ? null
      : results
          .map((item) => item.result.error)
          .filter(Boolean)
          .join(', ') || 'Push send failed.';

  await db
    .update(notifications)
    .set({
      status,
      providerMessageId: firstMessageId,
      failureReason,
      sentAt: status === 'SENT' ? new Date() : null,
    })
    .where(eq(notifications.id, created.id));

  await auditSend(created.id, input, actorUserId, status);

  return {
    id: created.id,
    status,
    deviceCount: usable.length,
    successCount: successful.length,
  };
}

async function auditSend(
  notificationId: string,
  input: AdminNotificationInput,
  actorUserId: string,
  status: 'SENT' | 'FAILED'
) {
  const db = await getDb();
  await db.insert(auditLogs).values({
    actorUserId,
    actorRole: 'ADMIN',
    action: 'CREATE',
    entityType: 'notification',
    entityId: notificationId,
    after: {
      userId: input.userId,
      eventKey: input.eventKey,
      channel: input.channel,
      category: input.category,
      status,
    },
    changedFields: ['recipient', 'eventKey', 'channel', 'category', 'status'],
    reason: 'Admin notification send',
  });
}
