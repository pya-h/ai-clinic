-- AlterTable
ALTER TABLE "appointment" ADD COLUMN     "calendly_cancel_url" TEXT,
ADD COLUMN     "calendly_event_uri" TEXT,
ADD COLUMN     "calendly_invitee_uri" TEXT,
ADD COLUMN     "calendly_reschedule_url" TEXT;
