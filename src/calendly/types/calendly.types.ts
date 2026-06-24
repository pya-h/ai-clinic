export interface CalendlyEventType {
  uri: string;
  name: string;
  slug: string;
  active: boolean;
  kind: 'solo' | 'group';
  duration: number;
  type: 'StandardEventType' | 'AdhocEventType';
  scheduling_url: string;
}

export interface CalendlyEventTypeListResponse {
  collection: CalendlyEventType[];
  pagination: {
    count: number;
    next_page: string | null;
    previous_page: string | null;
    next_page_token: string | null;
  };
}

export interface CalendlyScheduledEvent {
  uri: string;
  name: string;
  status: 'active' | 'canceled';
  start_time: string;
  end_time: string;
  event_type: string;
  location: {
    type: string;
    location?: string;
    join_url?: string;
  };
  invitees_counter: { total: number; active: number; limit: number };
  created_at: string;
  updated_at: string;
  event_memberships: { user: string }[];
  calendar_event?: {
    kind: string;
    external_id: string;
  };
  cancellation?: {
    canceled_by: string;
    reason: string;
  };
}

export interface CalendlyInvitee {
  uri: string;
  email: string;
  name: string;
  status: 'active' | 'canceled';
  reschedule_url: string;
  cancel_url: string;
  created_at: string;
  updated_at: string;
  event: string;
  cancellation?: {
    canceled_by: string;
    reason: string;
  };
}

export interface CalendlySchedulingLink {
  booking_url: string;
  owner: string;
  owner_type: 'EventType';
}

export interface CalendlyWebhookEvent {
  event: 'invitee.created' | 'invitee.canceled' | 'routing_form_submission.created';
  created_at: string;
  created_by: string;
  payload: CalendlyWebhookPayload;
}

export interface CalendlyWebhookPayload {
  uri: string;
  email: string;
  name: string;
  status: 'active' | 'canceled';
  reschedule_url: string;
  cancel_url: string;
  event: string;
  created_at: string;
  updated_at: string;
  tracking?: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
  };
  cancellation?: {
    canceled_by: string;
    reason: string;
  };
}
