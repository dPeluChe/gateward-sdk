import type { HttpClient, RequestOptions } from "./http.js";
import type { MembershipResponse, MembershipRole } from "./types.js";

export interface ListMembersQuery {
  limit?: number;
  offset?: number;
}

export interface MemberPage {
  members: MembershipResponse[];
  /** Total across all pages, from `X-Total-Count`. */
  total: number | undefined;
}

/** Shared by the API-key and app-admin clients: same routes, same shapes,
 *  only the credential differs. See docs/ARCHITECTURE/MEMBERS.md. */
export async function listMembers(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  query: ListMembersQuery = {},
): Promise<MemberPage> {
  const res = await http.requestWithMeta<MembershipResponse[]>(
    "GET",
    `/v1/apps/${appId}/members`,
    { ...auth, query: { limit: query.limit, offset: query.offset } },
  );
  return { members: res.data, total: res.totalCount };
}

export function getMember(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  userId: string,
): Promise<MembershipResponse> {
  return http.request<MembershipResponse>(
    "GET",
    `/v1/apps/${appId}/members/${userId}`,
    auth,
  );
}

export function setMemberRole(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  userId: string,
  role: MembershipRole,
): Promise<MembershipResponse> {
  return http.request<MembershipResponse>(
    "PATCH",
    `/v1/apps/${appId}/members/${userId}`,
    { ...auth, body: { role } },
  );
}
