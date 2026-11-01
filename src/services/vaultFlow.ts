// The steps behind the web version's password screen: find out whether the vault exists,
// create it (trial run on a copy first), unlock it, and encrypt anything still stored in
// plain text. Pure logic over CloudDocs, so it is tested without Firebase.

import {
  createVault, isVaultHeader, openVault, VAULT_DOC_ID, type CryptoLike, type Vault, type VaultHeader,
} from '../cloud/vault';
import { countPlain, encryptExisting, type CloudDocs, type MigrationReport } from '../storage/cloudBackend';

export interface VaultState {
  header: VaultHeader | null;
  /** Items still stored without encryption. */
  plain: number;
}

export async function readVaultState(docs: CloudDocs): Promise<VaultState> {
  const h = await docs.get(VAULT_DOC_ID);
  return { header: isVaultHeader(h) ? h : null, plain: await countPlain(docs) };
}

export interface Prepared {
  vault: Vault;
  header: VaultHeader;
  /** The trial run on a copy in memory. Null when there was nothing to encrypt. */
  trial: MigrationReport | null;
}

/** Makes the key from a new password and runs the migration on a copy. Writes nothing to Firebase. */
export async function prepareVault(
  docs: CloudDocs,
  password: string,
  opts: { crypto?: CryptoLike; iterations?: number; now?: Date } = {},
): Promise<Prepared> {
  const { header, vault } = await createVault(password, opts);
  const plain = await countPlain(docs);
  const trial = plain ? await encryptExisting(docs, vault, { trial: true }) : null;
  return { vault, header, trial };
}

/**
 * Stores the header (salt and check value) first, then encrypts the real data. The header
 * goes first so that an interrupted migration can always be finished with the same password.
 */
export async function commitVault(docs: CloudDocs, prepared: Prepared): Promise<MigrationReport | null> {
  if (prepared.trial && !prepared.trial.ok) throw new Error(prepared.trial.problem ?? 'Provkörningen misslyckades.');
  const existing = await docs.get(VAULT_DOC_ID);
  if (isVaultHeader(existing)) throw new Error('Det finns redan ett lösenord för dina data. Lås upp med det i stället.');
  await docs.set(VAULT_DOC_ID, prepared.header);
  return prepared.trial ? encryptExisting(docs, prepared.vault) : null;
}

/**
 * Opens the vault and finishes any encryption left: an interrupted migration, or items an
 * older version of the app wrote in plain text. A trial run on a copy goes first.
 */
export async function unlockVault(
  docs: CloudDocs,
  header: VaultHeader,
  password: string,
  opts: { crypto?: CryptoLike } = {},
): Promise<{ vault: Vault; report: MigrationReport | null }> {
  const vault = await openVault(password, header, opts);
  if (!(await countPlain(docs))) return { vault, report: null };
  const trial = await encryptExisting(docs, vault, { trial: true });
  if (!trial.ok) throw new Error(trial.problem ?? 'Provkörningen misslyckades.');
  return { vault, report: await encryptExisting(docs, vault) };
}
