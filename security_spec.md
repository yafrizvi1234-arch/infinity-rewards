# Security Specification — INFINITY REWARDS Admin & Phase 4 Audit

## 1. Data Invariants
1. All Firestore reads and writes require a verified Firebase Auth session (`request.auth != null && request.auth.token.email_verified == true`).
2. Admin authorization is **strictly email-based** via Firebase Auth verified token: `request.auth.token.email is string && request.auth.token.email.lower() == 'yafrizvi1234@gmail.com' && request.auth.token.email_verified == true`. No UID-based `/admins` lookup or role claim is accepted.
3. `/admins/{docId}` denies all client reads and writes (`allow read, write: if false;`), preventing users from reading, listing, creating, or altering admin records.
4. Private workspace `/users/{userId}` is readable ONLY by `request.auth.uid == userId`; collection `list` is denied. Neither `/users` nor `/publicProfiles` allows `role` or `isAdmin` fields.
5. Submitted links in `/links/{linkId}` MUST initialize with `status == 'pending'` and `ownerId == request.auth.uid`. Non-admins cannot self-approve, reject, read another user's pending/rejected link, or moderate any link.
6. Editing a submitted link by its owner resets/enforces `status == 'pending'` and atomically updates `/linkRegistry/{urlKey}` if the URL changed.
7. Only verified admin (`yafrizvi1234@gmail.com` case-insensitive with `email_verified == true`) can set `/links/{linkId}.status` to `'approved'` or `'rejected'`, remove arbitrary links, update/delete `/linkReports`, and read/write `/moderationLogs`.
8. `/moderationLogs/{logId}` requires `adminEmail.lower() == 'yafrizvi1234@gmail.com'` and `adminUid == request.auth.uid`, and forbids all updates/deletes.

## 2. Adversarial Payloads & Admin Security Matrix (Must Return PERMISSION_DENIED)
1. Unauthenticated read/write on any collection.
2. Unverified admin email (`yafrizvi1234@gmail.com` with `email_verified == false`) attempting admin moderation or reading `/moderationLogs`.
3. Non-admin verified email (`other@example.com` with `email_verified == true`) attempting to approve/reject links, read `/moderationLogs`, or resolve `/linkReports`.
4. Regular user or admin attempting to create, read, list, update, or delete `/admins/{anything}`.
5. Privilege escalation: regular user attempting to inject `isAdmin: true` or `role: 'admin'` into `/users/{uid}` or `/publicProfiles/{uid}`.
6. Self-approval on create: `userA` submitting `/links/{id}` with `status: 'approved'`.
7. Non-admin approval update: `userA` updating their own pending link or another user's link to `status: 'approved'` or `'rejected'`.
8. Cross-user link hijack: `userB` updating or deleting `userA`'s `/links/{id}` or `/linkRegistry/{urlKey}`.
9. Bait-and-switch URL edit: `userA` updating `url` on an `approved` link while keeping `status: 'approved'`.
10. Unapproved link scraping: non-admin `userB` calling `get` or `list` on `userA`'s `pending` or `rejected` link.
11. Spoofed moderation log: non-admin writing `/moderationLogs/{id}` or admin log with non-matching `adminEmail`.
12. Non-admin updating or deleting `/linkReports/{id}`.
13. Self-activation of Multi (5): regular user creating or updating `/multiEntitlements/{uid}` directly.
14. Cross-user activation: activating `/multiEntitlements/{otherUid}` referencing `userA`'s `/paymentRequests/{reqId}`.
15. Unverified activation: admin creating `/multiEntitlements/{uid}` without an atomically approved `/paymentRequests/{reqId}` (`amountBdt == 50`, `planId == 'multi_5'`).
16. Self-approval on payment submission: user creating `/paymentRequests/{id}` with `status: 'approved'` or `amountBdt != 50`.
17. Duplicate Transaction ID: any user submitting `/paymentRequests` with a `transactionId` already claimed in `/paymentTransactions/{txKey}` (including case variations).
18. Non-admin approving/rejecting `/paymentRequests/{id}` or reading another user's payment screenshot/request.
19. Non-admin or unverified user modifying `/paymentConfig/multi_5` bKash or Nagad payment numbers.
20. Listing `/paymentConfig` collection or creating arbitrary `/paymentConfig/{otherId}` documents.
21. User B or Admin reading, listing, creating, updating, or deleting User A's `/adsterraIntegrations/{userA}`.
22. User A injecting a raw `apiKey`, `secret`, or `token` field into `/adsterraIntegrations/{userA}` (must be blocked by strict `hasOnly` schema).
23. User B or Admin reading, listing, creating, updating, or deleting User A's `/userSmartlinks/{linkId}`.
24. User A creating `/userSmartlinks/{linkId}` with `ownerUserId != request.auth.uid`.
25. User A calling backend `/api/adsterra/*` without a valid verified Firebase ID Token Bearer header.

