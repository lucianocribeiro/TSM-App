import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildDocumentoPath } from "@/lib/documentos/paths";
import { DOCUMENTOS_BUCKET, type DocumentoTipo } from "@/lib/documentos/tipos";
import {
  anonClient,
  createTestUser,
  deleteTestUsers,
  serviceClient,
  type TestUser,
  type TypedClient,
} from "./helpers";

// The signed URL helper uses the session-bound server client. Here that client
// is replaced by the signed-in test user's client, so the storage policies
// decide exactly as they do in the app.
const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

const { createDocumentoSignedUrl, SIGNED_URL_TTL_SECONDS } = await import(
  "@/lib/documentos/signed-url"
);

// RLS, grants, constraints and storage policies for public.legajo_documentos
// and the legajo-docs bucket. Assertions run through user sessions; the
// service-role client is used for setup and for reading back stored state only.

const PERMISSION_DENIED = "42501";
const UNIQUE_VIOLATION = "23505";
const RLS_VIOLATION = /row-level security/i;
const TIPOS: DocumentoTipo[] = ["dni_frente", "dni_dorso", "licencia_conducir"];

function fakePdf(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% FAKE TEST FILE - ${label}\n%%EOF\n`);
}

function newPath(profileId: string, tipo: DocumentoTipo, mimeType = "application/pdf"): string {
  const path = buildDocumentoPath({ profileId, tipo, fileId: randomUUID(), mimeType });
  if (!path) throw new Error("invalid test path");
  return path;
}

describe("legajo_documentos and legajo-docs storage RLS", () => {
  const service = serviceClient();
  let empleadoA: TestUser;
  let empleadoB: TestUser;
  let admin: TestUser;
  let legajoA: string;
  let legajoB: string;
  let pathB: string;
  let docB: string;
  const contentB = fakePdf("Empleado B dni_frente");
  // Deleted in order: employees before the admin who uploaded to their legajos.
  const createdUserIds: string[] = [];
  const createdPaths: string[] = [];

  async function legajoIdOf(profileId: string): Promise<string> {
    const { data, error } = await service
      .from("legajos")
      .select("id")
      .eq("profile_id", profileId)
      .single();
    if (error || !data) throw new Error(`legajo lookup failed: ${error?.message}`);
    return data.id;
  }

  function bucket(client: TypedClient) {
    return client.storage.from(DOCUMENTOS_BUCKET);
  }

  async function upload(client: TypedClient, path: string, body: Buffer, contentType = "application/pdf") {
    createdPaths.push(path);
    return bucket(client).upload(path, body, { contentType, upsert: false });
  }

  // Reads the stored object with the service role; null when it does not exist.
  async function storedObject(path: string): Promise<string | null> {
    const { data, error } = await bucket(service).download(path);
    if (error || !data) return null;
    return data.text();
  }

  function metadata(legajoId: string, tipo: DocumentoTipo, path: string, uploadedBy: string, size: number) {
    return {
      legajo_id: legajoId,
      tipo,
      storage_path: path,
      file_name: `${tipo}-prueba.pdf`,
      mime_type: "application/pdf",
      size_bytes: size,
      uploaded_by: uploadedBy,
    };
  }

  async function storedRows(legajoId: string) {
    const { data, error } = await service
      .from("legajo_documentos")
      .select("*")
      .eq("legajo_id", legajoId);
    expect(error).toBeNull();
    return data ?? [];
  }

  beforeAll(async () => {
    empleadoA = await createTestUser(service, "docs-empleado-a");
    empleadoB = await createTestUser(service, "docs-empleado-b");
    admin = await createTestUser(service, "docs-admin", "admin");
    createdUserIds.push(empleadoA.id, empleadoB.id);

    legajoA = await legajoIdOf(empleadoA.id);
    legajoB = await legajoIdOf(empleadoB.id);

    // Empleado B's document, set up with the service role.
    pathB = newPath(empleadoB.id, "dni_frente");
    const uploaded = await upload(service, pathB, contentB);
    if (uploaded.error) throw new Error(`object setup failed: ${uploaded.error.message}`);
    const { data, error } = await service
      .from("legajo_documentos")
      .insert(metadata(legajoB, "dni_frente", pathB, empleadoB.id, contentB.length))
      .select("id")
      .single();
    if (error || !data) throw new Error(`metadata setup failed: ${error?.message}`);
    docB = data.id;
  });

  afterAll(async () => {
    await bucket(service).remove(createdPaths);
    await deleteTestUsers(service, [...createdUserIds, admin.id]);
  });

  describe("bucket", () => {
    it("is private with a 10 MB limit and PDF, JPEG and PNG only", async () => {
      const { data, error } = await service.storage.getBucket(DOCUMENTOS_BUCKET);
      expect(error).toBeNull();
      expect(data?.public).toBe(false);
      expect(data?.file_size_limit).toBe(10485760);
      expect([...(data?.allowed_mime_types ?? [])].sort()).toEqual([
        "application/pdf",
        "image/jpeg",
        "image/png",
      ]);
    });

    it("rejects a file over 10 MB", async () => {
      const path = newPath(empleadoA.id, "dni_dorso");
      const tooLarge = Buffer.alloc(10485760 + 1, 0x20);
      const { error } = await upload(empleadoA.client, path, tooLarge);
      expect(error?.message).toMatch(/maximum allowed size/i);
      expect(await storedObject(path)).toBeNull();
    });

    it("rejects a MIME type that is not allowed", async () => {
      const path = newPath(empleadoA.id, "dni_dorso");
      const { error } = await upload(empleadoA.client, path, Buffer.from("<p>fake</p>"), "text/html");
      expect(error?.message).toMatch(/mime type/i);
      expect(await storedObject(path)).toBeNull();
    });
  });

  describe("anonymous", () => {
    it("cannot list, read or upload objects", async () => {
      const anon = anonClient();

      const list = await bucket(anon).list(empleadoB.id);
      expect(list.data ?? []).toEqual([]);

      const download = await bucket(anon).download(pathB);
      expect(download.data).toBeNull();
      expect(download.error).not.toBeNull();

      const signed = await bucket(anon).createSignedUrl(pathB, 60);
      expect(signed.data).toBeNull();
      expect(signed.error).not.toBeNull();

      const path = newPath(empleadoB.id, "dni_dorso");
      const uploaded = await upload(anon, path, fakePdf("anon"));
      expect(uploaded.error?.message).toMatch(RLS_VIOLATION);
      expect(await storedObject(path)).toBeNull();
    });

    it("cannot read objects through a public URL", async () => {
      const { data } = bucket(anonClient()).getPublicUrl(pathB);
      const response = await fetch(data.publicUrl);
      expect(response.ok).toBe(false);
    });

    it("cannot read or write legajo_documentos", async () => {
      const anon = anonClient();
      const select = await anon.from("legajo_documentos").select("*");
      expect(select.data).toBeNull();
      expect(select.error?.code).toBe(PERMISSION_DENIED);

      const insert = await anon
        .from("legajo_documentos")
        .insert(metadata(legajoB, "dni_dorso", newPath(empleadoB.id, "dni_dorso"), empleadoB.id, 10));
      expect(insert.error?.code).toBe(PERMISSION_DENIED);

      const del = await anon.from("legajo_documentos").delete().eq("id", docB).select();
      expect(del.error?.code).toBe(PERMISSION_DENIED);
    });
  });

  describe("empleado own documents", () => {
    it("uploads to the own folder and creates the metadata row", async () => {
      const path = newPath(empleadoA.id, "dni_frente");
      const content = fakePdf("Empleado A dni_frente");
      const uploaded = await upload(empleadoA.client, path, content);
      expect(uploaded.error).toBeNull();
      expect(await storedObject(path)).toBe(content.toString());

      const { data, error } = await empleadoA.client
        .from("legajo_documentos")
        .insert(metadata(legajoA, "dni_frente", path, empleadoA.id, content.length))
        .select()
        .single();
      expect(error).toBeNull();
      expect(data?.storage_path).toBe(path);

      const list = await bucket(empleadoA.client).list(`${empleadoA.id}/dni_frente`);
      expect(list.error).toBeNull();
      expect(list.data?.map((object) => object.name)).toContain(path.split("/")[2]);

      await service.from("legajo_documentos").delete().eq("legajo_id", legajoA);
    });

    it("cannot upload to the own folder with an invalid path", async () => {
      const fileId = randomUUID();
      const invalid = [
        `${empleadoA.id}/pasaporte/${fileId}.pdf`,
        `${empleadoA.id}/dni_frente/${fileId}.html`,
        `${empleadoA.id}/dni_frente/extra/${fileId}.pdf`,
        `${empleadoA.id}/${fileId}.pdf`,
      ];
      for (const path of invalid) {
        const { error } = await upload(empleadoA.client, path, fakePdf("invalid"));
        expect(error?.message, path).toMatch(RLS_VIOLATION);
        expect(await storedObject(path), path).toBeNull();
      }
    });

    it("replaces the own document: new object, updated row, old object removed", async () => {
      const oldPath = newPath(empleadoA.id, "dni_dorso");
      const oldContent = fakePdf("A dni_dorso v1");
      expect((await upload(empleadoA.client, oldPath, oldContent)).error).toBeNull();
      const inserted = await empleadoA.client
        .from("legajo_documentos")
        .insert(metadata(legajoA, "dni_dorso", oldPath, empleadoA.id, oldContent.length))
        .select("id")
        .single();
      expect(inserted.error).toBeNull();
      const id = inserted.data?.id ?? "";

      const newPathA = newPath(empleadoA.id, "dni_dorso", "image/png");
      const newContent = Buffer.from("FAKE TEST PNG - A dni_dorso v2");
      expect((await upload(empleadoA.client, newPathA, newContent, "image/png")).error).toBeNull();

      const updated = await empleadoA.client
        .from("legajo_documentos")
        .update({
          storage_path: newPathA,
          file_name: "dni-dorso-v2.png",
          mime_type: "image/png",
          size_bytes: newContent.length,
          uploaded_by: empleadoA.id,
        })
        .eq("id", id)
        .select()
        .single();
      expect(updated.error).toBeNull();
      expect(updated.data?.storage_path).toBe(newPathA);

      const removed = await bucket(empleadoA.client).remove([oldPath]);
      expect(removed.error).toBeNull();
      expect(removed.data?.map((object) => object.name)).toEqual([oldPath]);
      expect(await storedObject(oldPath)).toBeNull();
      expect(await storedObject(newPathA)).toBe(newContent.toString());

      // Delete: object and row.
      const removedNew = await bucket(empleadoA.client).remove([newPathA]);
      expect(removedNew.data?.map((object) => object.name)).toEqual([newPathA]);
      const deleted = await empleadoA.client.from("legajo_documentos").delete().eq("id", id).select();
      expect(deleted.error).toBeNull();
      expect(deleted.data).toHaveLength(1);

      expect(await storedObject(newPathA)).toBeNull();
      expect(await storedRows(legajoA)).toEqual([]);
    });

    it("allows only one current document per type", async () => {
      const first = newPath(empleadoA.id, "licencia_conducir");
      const second = newPath(empleadoA.id, "licencia_conducir");
      const insertFirst = await empleadoA.client
        .from("legajo_documentos")
        .insert(metadata(legajoA, "licencia_conducir", first, empleadoA.id, 10));
      expect(insertFirst.error).toBeNull();

      const insertSecond = await empleadoA.client
        .from("legajo_documentos")
        .insert(metadata(legajoA, "licencia_conducir", second, empleadoA.id, 10));
      expect(insertSecond.error?.code).toBe(UNIQUE_VIOLATION);

      await service.from("legajo_documentos").delete().eq("legajo_id", legajoA);
    });
  });

  describe("empleado boundaries", () => {
    it("cannot upload under another employee's folder, for any type", async () => {
      for (const tipo of TIPOS) {
        const path = newPath(empleadoB.id, tipo);
        const { error } = await upload(empleadoA.client, path, fakePdf("A into B"));
        expect(error?.message, tipo).toMatch(RLS_VIOLATION);
        expect(await storedObject(path), tipo).toBeNull();
      }
    });

    it("cannot list, download, overwrite or delete another employee's object", async () => {
      const list = await bucket(empleadoA.client).list(`${empleadoB.id}/dni_frente`);
      expect(list.data ?? []).toEqual([]);

      const download = await bucket(empleadoA.client).download(pathB);
      expect(download.data).toBeNull();
      expect(download.error).not.toBeNull();

      const overwrite = await bucket(empleadoA.client).update(pathB, fakePdf("A overwrites B"), {
        contentType: "application/pdf",
      });
      expect(overwrite.error).not.toBeNull();

      const moved = await bucket(empleadoA.client).move(pathB, newPath(empleadoA.id, "dni_frente"));
      expect(moved.error).not.toBeNull();

      const removed = await bucket(empleadoA.client).remove([pathB]);
      expect(removed.data ?? []).toEqual([]);

      expect(await storedObject(pathB)).toBe(contentB.toString());
    });

    it("cannot read another employee's metadata rows", async () => {
      const all = await empleadoA.client.from("legajo_documentos").select("*");
      expect(all.error).toBeNull();
      expect(all.data?.filter((row) => row.legajo_id !== legajoA)).toEqual([]);

      const byId = await empleadoA.client.from("legajo_documentos").select("*").eq("id", docB);
      expect(byId.error).toBeNull();
      expect(byId.data).toEqual([]);
    });

    it("cannot update or delete another employee's metadata rows", async () => {
      const updated = await empleadoA.client
        .from("legajo_documentos")
        .update({ file_name: "hacked.pdf" })
        .eq("id", docB)
        .select();
      expect(updated.error).toBeNull();
      expect(updated.data).toEqual([]);

      const deleted = await empleadoA.client.from("legajo_documentos").delete().eq("id", docB).select();
      expect(deleted.error).toBeNull();
      expect(deleted.data).toEqual([]);

      const rows = await storedRows(legajoB);
      expect(rows).toHaveLength(1);
      expect(rows[0].file_name).toBe("dni_frente-prueba.pdf");
    });

    it("cannot insert a metadata row for another employee's legajo", async () => {
      const inB = newPath(empleadoB.id, "dni_dorso");
      const toB = await empleadoA.client
        .from("legajo_documentos")
        .insert(metadata(legajoB, "dni_dorso", inB, empleadoA.id, 10));
      expect(toB.error?.code).toBe(PERMISSION_DENIED);

      // Own folder, but B's legajo.
      const mixed = await empleadoA.client
        .from("legajo_documentos")
        .insert(metadata(legajoB, "dni_dorso", newPath(empleadoA.id, "dni_dorso"), empleadoA.id, 10));
      expect(mixed.error?.code).toBe(PERMISSION_DENIED);

      // Own legajo, but a path in B's folder.
      const wrongFolder = await empleadoA.client
        .from("legajo_documentos")
        .insert(metadata(legajoA, "dni_dorso", inB, empleadoA.id, 10));
      expect(wrongFolder.error?.code).toBe(PERMISSION_DENIED);

      expect(await storedRows(legajoB)).toHaveLength(1);
      expect(await storedRows(legajoA)).toEqual([]);
    });

    it("cannot set uploaded_by to another user", async () => {
      const path = newPath(empleadoA.id, "dni_dorso");
      const insert = await empleadoA.client
        .from("legajo_documentos")
        .insert(metadata(legajoA, "dni_dorso", path, admin.id, 10));
      expect(insert.error?.code).toBe(PERMISSION_DENIED);

      const own = await empleadoA.client
        .from("legajo_documentos")
        .insert(metadata(legajoA, "dni_dorso", path, empleadoA.id, 10))
        .select("id")
        .single();
      expect(own.error).toBeNull();

      const update = await empleadoA.client
        .from("legajo_documentos")
        .update({ uploaded_by: empleadoB.id })
        .eq("id", own.data?.id ?? "")
        .select();
      expect(update.error?.code).toBe(PERMISSION_DENIED);

      const rows = await storedRows(legajoA);
      expect(rows.map((row) => row.uploaded_by)).toEqual([empleadoA.id]);
      await service.from("legajo_documentos").delete().eq("legajo_id", legajoA);
    });

    it("cannot move a metadata row to another legajo", async () => {
      const own = await empleadoA.client
        .from("legajo_documentos")
        .insert(metadata(legajoA, "dni_dorso", newPath(empleadoA.id, "dni_dorso"), empleadoA.id, 10))
        .select("id")
        .single();
      expect(own.error).toBeNull();

      const moved = await empleadoA.client
        .from("legajo_documentos")
        .update({ legajo_id: legajoB })
        .eq("id", own.data?.id ?? "")
        .select();
      expect(moved.error?.code).toBe(PERMISSION_DENIED);

      // Nor with a path in B's folder.
      const pathMoved = await empleadoA.client
        .from("legajo_documentos")
        .update({ storage_path: newPath(empleadoB.id, "dni_dorso") })
        .eq("id", own.data?.id ?? "")
        .select();
      expect(pathMoved.error?.code).toBe(PERMISSION_DENIED);

      expect(await storedRows(legajoA)).toHaveLength(1);
      expect(await storedRows(legajoB)).toHaveLength(1);
      await service.from("legajo_documentos").delete().eq("legajo_id", legajoA);
    });
  });

  describe("admin", () => {
    it("reads all metadata rows", async () => {
      const ownA = await service
        .from("legajo_documentos")
        .insert(metadata(legajoA, "dni_frente", newPath(empleadoA.id, "dni_frente"), empleadoA.id, 10))
        .select("id")
        .single();
      expect(ownA.error).toBeNull();

      const { data, error } = await admin.client
        .from("legajo_documentos")
        .select("id, legajo_id")
        .in("legajo_id", [legajoA, legajoB]);
      expect(error).toBeNull();
      expect(data?.map((row) => row.legajo_id).sort()).toEqual([legajoA, legajoB].sort());

      await service.from("legajo_documentos").delete().eq("legajo_id", legajoA);
    });

    it("uploads, downloads, replaces and deletes for any employee", async () => {
      const path = newPath(empleadoA.id, "licencia_conducir");
      const content = fakePdf("Admin into A licencia");
      expect((await upload(admin.client, path, content)).error).toBeNull();

      const inserted = await admin.client
        .from("legajo_documentos")
        .insert(metadata(legajoA, "licencia_conducir", path, admin.id, content.length))
        .select("id")
        .single();
      expect(inserted.error).toBeNull();
      const id = inserted.data?.id ?? "";

      const download = await bucket(admin.client).download(path);
      expect(download.error).toBeNull();
      expect(await download.data?.text()).toBe(content.toString());

      // Empleado A sees the document the admin uploaded to their legajo.
      const seenByA = await empleadoA.client.from("legajo_documentos").select("id").eq("id", id);
      expect(seenByA.data).toEqual([{ id }]);

      // Replace.
      const replacement = newPath(empleadoA.id, "licencia_conducir", "image/jpeg");
      const jpg = Buffer.from("FAKE TEST JPG - admin replacement");
      expect((await upload(admin.client, replacement, jpg, "image/jpeg")).error).toBeNull();
      const updated = await admin.client
        .from("legajo_documentos")
        .update({
          storage_path: replacement,
          file_name: "licencia.jpg",
          mime_type: "image/jpeg",
          size_bytes: jpg.length,
          uploaded_by: admin.id,
        })
        .eq("id", id)
        .select()
        .single();
      expect(updated.error).toBeNull();
      const removedOld = await bucket(admin.client).remove([path]);
      expect(removedOld.data?.map((object) => object.name)).toEqual([path]);

      // Also another employee's existing object.
      const downloadB = await bucket(admin.client).download(pathB);
      expect(await downloadB.data?.text()).toBe(contentB.toString());

      // Delete.
      const removed = await bucket(admin.client).remove([replacement]);
      expect(removed.data?.map((object) => object.name)).toEqual([replacement]);
      const deleted = await admin.client.from("legajo_documentos").delete().eq("id", id).select();
      expect(deleted.data).toHaveLength(1);

      expect(await storedObject(path)).toBeNull();
      expect(await storedObject(replacement)).toBeNull();
      expect(await storedRows(legajoA)).toEqual([]);
    });

    it("cannot upload to an invalid path or a folder that is not a profile", async () => {
      const invalid = [
        `${empleadoA.id}/pasaporte/${randomUUID()}.pdf`,
        newPath(randomUUID(), "dni_frente"),
      ];
      for (const path of invalid) {
        const { error } = await upload(admin.client, path, fakePdf("admin invalid"));
        expect(error?.message, path).toMatch(RLS_VIOLATION);
        expect(await storedObject(path), path).toBeNull();
      }
    });

    it("cannot set uploaded_by to another user", async () => {
      const insert = await admin.client
        .from("legajo_documentos")
        .insert(metadata(legajoA, "dni_frente", newPath(empleadoA.id, "dni_frente"), empleadoA.id, 10));
      expect(insert.error?.code).toBe(PERMISSION_DENIED);
    });
  });

  describe("signed URLs", () => {
    it("works for the own object and not for another employee's object", async () => {
      const path = newPath(empleadoA.id, "dni_frente");
      const content = fakePdf("A signed");
      expect((await upload(empleadoA.client, path, content)).error).toBeNull();

      session.client = empleadoA.client;
      const own = await createDocumentoSignedUrl(path);
      expect(own.ok).toBe(true);
      const url = own.ok ? own.data?.url ?? "" : "";
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(content.toString());

      const other = await createDocumentoSignedUrl(pathB);
      expect(other.ok).toBe(false);

      const direct = await bucket(empleadoA.client).createSignedUrl(pathB, SIGNED_URL_TTL_SECONDS);
      expect(direct.data).toBeNull();
      expect(direct.error).not.toBeNull();
      session.client = null;
    });

    it("works for an admin on any employee's object", async () => {
      session.client = admin.client;
      const result = await createDocumentoSignedUrl(pathB);
      expect(result.ok).toBe(true);
      const response = await fetch(result.ok ? result.data?.url ?? "" : "");
      expect(await response.text()).toBe(contentB.toString());
      session.client = null;
    });

    it("rejects a path that does not follow the convention without calling storage", async () => {
      session.client = empleadoA.client;
      expect((await createDocumentoSignedUrl(`../${pathB}`)).ok).toBe(false);
      session.client = null;
    });
  });

  describe("cascade", () => {
    it("deleting a profile removes its legajo's metadata rows", async () => {
      const user = await createTestUser(service, "docs-cascade");
      const legajo = await legajoIdOf(user.id);
      const path = newPath(user.id, "dni_frente");
      expect((await upload(user.client, path, fakePdf("cascade"))).error).toBeNull();
      const inserted = await user.client
        .from("legajo_documentos")
        .insert(metadata(legajo, "dni_frente", path, user.id, 10));
      expect(inserted.error).toBeNull();
      expect(await storedRows(legajo)).toHaveLength(1);

      await deleteTestUsers(service, [user.id]);

      const { data, error } = await service.from("legajo_documentos").select("id").eq("storage_path", path);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });
});
