import type { Contact } from "@/api";

const CONTACT_KEY = "booking:contact";
const seatsKey = (screeningId: string) => `booking:seats:${screeningId}`;
const pendingKey = (screeningId: string) => `booking:pending:${screeningId}`;

export interface PendingBooking {
  requestId: string;
  seats: string[];
  contact: Contact;
  measure: boolean;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
  }
}

export const loadContact = () => read<Contact>(CONTACT_KEY);
export const saveContact = (contact: Contact) => write(CONTACT_KEY, contact);

export const loadSeats = (screeningId: string) => read<string[]>(seatsKey(screeningId)) ?? [];
export const saveSeats = (screeningId: string, seats: string[]) => (seats.length ? write(seatsKey(screeningId), seats) : remove(seatsKey(screeningId)));

export function clearDraft(screeningId: string) {
  remove(CONTACT_KEY);
  remove(seatsKey(screeningId));
}

export const loadPending = (screeningId: string) => read<PendingBooking>(pendingKey(screeningId));
export const savePending = (screeningId: string, pending: PendingBooking) => write(pendingKey(screeningId), pending);
export const clearPending = (screeningId: string) => remove(pendingKey(screeningId));
