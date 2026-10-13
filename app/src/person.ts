const PEOPLE_KEY = "wit.people.v1";
const CURRENT_KEY = "wit.person.current";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type Person = {
  id: string;
  name: string;
  createdAt: string;
};

export function newPersonId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const body = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `WIT-${body}`;
}

function readPeople(): Person[] {
  try {
    const raw = localStorage.getItem(PEOPLE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Person[]) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.id === "string") : [];
  } catch {
    return [];
  }
}

function writePeople(people: Person[]) {
  localStorage.setItem(PEOPLE_KEY, JSON.stringify(people.slice(0, 80)));
}

export function listPeople(): Person[] {
  return readPeople();
}

export function currentPerson(): Person {
  const people = readPeople();
  const currentId = localStorage.getItem(CURRENT_KEY);
  const found = people.find((p) => p.id === currentId);
  if (found) return found;
  const created = createPerson("");
  return created;
}

export function createPerson(name: string): Person {
  const person: Person = {
    id: newPersonId(),
    name: name.trim(),
    createdAt: new Date().toISOString(),
  };
  const people = readPeople().filter((p) => p.id !== person.id);
  people.unshift(person);
  writePeople(people);
  localStorage.setItem(CURRENT_KEY, person.id);
  return person;
}

export function renamePerson(id: string, name: string): Person | null {
  const people = readPeople();
  const next = people.map((p) => (p.id === id ? { ...p, name: name.trim() } : p));
  const found = next.find((p) => p.id === id) ?? null;
  if (!found) return null;
  writePeople(next);
  return found;
}

export function switchPerson(id: string): Person | null {
  const found = readPeople().find((p) => p.id === id);
  if (!found) return null;
  localStorage.setItem(CURRENT_KEY, id);
  return found;
}
