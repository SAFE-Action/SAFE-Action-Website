# Volunteer Onboarding System + Google Cloud Migration

**Date:** 2026-03-14
**Status:** Approved

## Overview

Complete volunteer onboarding system for SAFE Action with full Google Workspace automation, plus migration of hosting from Vercel to Firebase Hosting with Google Cloud Functions.

## Part 1: Infrastructure Migration (Vercel → Google)

### Firebase Hosting
- Replaces Vercel for static file serving
- `firebase.json` replaces `vercel.json`
- Clean URLs, same rewrites: `/candidates/:slug`, `/admin`, `/feed`, `/volunteer`
- Domain: `scienceandfreedom.com` pointed to Firebase Hosting

### Google Cloud Functions (2nd gen, Node.js)
- Replaces Vercel serverless functions
- All functions in `/functions` directory with own `package.json`
- Migrated: `districts` (from `/api/districts.js`)
- New: `volunteerApply`, `volunteerApprove`, `volunteerReject`, `volunteerSignNda`

### What stays the same
- Firebase Firestore (already in use)
- Firebase Auth + Google Sign-in (admin panel)
- All frontend HTML/CSS/JS
- Service worker, PWA manifest
- Static data files (`/data/*.json`)

### What gets removed
- `vercel.json`
- `/api/districts.js` (moved to Cloud Functions)
- Vercel CLI dependency

## Part 2: Volunteer Application Form

### Page: `volunteer.html`
- Linked from footer on all pages
- Fields:
  - Full Name (required, text)
  - Email (required, email)
  - Skills (multi-select checkboxes): Web Development, Backend, Design, Product, Marketing, Operations, Other
  - Monthly Availability (dropdown): 5 hrs, 10 hrs, 20 hrs, 40+ hrs
  - Interests (multi-select checkboxes): Developing Web Apps, Developing New Tools, Curating Pipeline, Research, Community Building
- Submits to `volunteerApply` Cloud Function
- Success state shows confirmation message

## Part 3: Admin Dashboard — Volunteers Tab

### Added to existing `admin.html`
- New "Volunteers" tab alongside existing bill queue
- Three sub-views: Pending, Approved, Rejected
- Each pending application shows: name, email, skills, interests, availability, applied date
- "Approve" button → triggers full onboarding automation
- "Reject" button → optional rejection reason field

## Part 4: Cloud Functions API

### `volunteerApply` (POST)
- Validates input
- Saves to Firestore `volunteers` collection
- Sends notification email to officer@scienceandfreedom.com via Gmail SMTP
- Returns success/error

### `volunteerApprove` (POST, admin-authenticated)
- Verifies admin auth (Firebase ID token)
- Updates volunteer status to "approved"
- Triggers onboarding automation:
  1. Send welcome email to volunteer (includes NDA signing link)
  2. Create Google Drive folder (under shared Volunteers parent)
  3. Add to Google Contacts (skills/interests in notes)
  4. Invite to Google Chat space
  5. Add to weekly Google Calendar event
- Tracks each step's success in `onboardingSteps` field
- Returns status of each step

### `volunteerReject` (POST, admin-authenticated)
- Verifies admin auth
- Updates status to "rejected" with optional reason
- Optionally sends rejection email

### `volunteerSignNda` (POST)
- Validates one-time token (stored in Firestore)
- Records: typed name, timestamp, IP address
- Generates signed PDF with volunteer info + agreement text
- Uploads PDF to volunteer's Google Drive folder
- Updates Firestore: ndaSigned=true, ndaSignedAt, ndaIp

### `districts` (GET)
- Migrated from existing `/api/districts.js`
- Same Census geocoder proxy logic
- Same caching behavior

## Part 5: NDA Flow

### Template content
- SAFE Action Volunteer Non-Disclosure Agreement
- Covers: confidential information, non-compete during engagement, ongoing obligations
- Volunteer and SAFE Action sign-off fields

### Signing flow
1. Admin approves volunteer → welcome email sent with NDA link (`/volunteer/nda?token=xxx`)
2. Volunteer opens link → sees NDA text in browser
3. Types full name, checks "I Agree" checkbox, submits
4. Cloud Function records signature (name, IP, timestamp) in Firestore
5. PDF generated with agreement text + signature block → uploaded to volunteer's Drive folder
6. Admin dashboard shows NDA status

## Part 6: Firestore Schema

### `volunteers` collection
```
{
  id: auto-generated,
  name: string,
  email: string,
  skills: string[],
  interests: string[],
  availability: string,
  status: "pending" | "approved" | "rejected",
  appliedAt: timestamp,
  approvedBy: string (admin email),
  approvedAt: timestamp,
  rejectionReason: string,
  onboardingSteps: {
    welcomeEmail: boolean,
    driveFolder: boolean,
    googleContact: boolean,
    chatInvite: boolean,
    calendarInvite: boolean
  },
  ndaSigned: boolean,
  ndaSignedAt: timestamp,
  ndaIp: string,
  ndaToken: string,
  driveFolder: string (folder URL),
  createdAt: timestamp,
  updatedAt: timestamp
}
```

## Part 7: Google Workspace Integration

### Service account with domain-wide delegation
- Gmail API: send as officer@scienceandfreedom.com
- Google Contacts API (People API): create contacts in org directory
- Google Drive API: create folders, upload PDFs
- Google Calendar API: add attendees to existing event
- Google Chat API: add members to existing space

### Required scopes
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/contacts`
- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/chat.memberships`

## Part 8: Email Templates

### Application notification (to officer@scienceandfreedom.com)
- Subject: "New Volunteer Application: {name}"
- Body: name, email, skills, interests, availability, link to admin panel

### Welcome email (to volunteer)
- Subject: "Welcome to SAFE Action!"
- Body: introduction, what to expect, NDA signing link, Drive folder link

### Rejection email (optional, to volunteer)
- Subject: "SAFE Action Volunteer Application Update"
- Body: thank them, explain decision briefly
