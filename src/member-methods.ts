import { appMethods } from "@fungi.computer/agar/backend";
import type { CapabilityDirectory } from "@fungi.computer/agar";
import type { WhistleJsonValue } from "@fungi.computer/whistle";

/**
 * The hidden methods a signed-in member's own Prints window, and the Hub Media
 * library, call. The host names the caller (member, Computer) separately from
 * the input; each method refuses any other actor kind.
 */
export const memberMethods = {
  readNotices: "member.readNotices",
  dismissNotices: "member.dismissNotices",
  listStyles: "member.listStyles",
  saveStyle: "member.saveStyle",
  deleteStyle: "member.deleteStyle",
  readPrintStyle: "member.readPrintStyle",
  listCharacters: "member.listCharacters",
  saveCharacter: "member.saveCharacter",
  deleteCharacter: "member.deleteCharacter",
  readFolder: "member.readFolder",
  selectFolder: "member.selectFolder",
  rememberGeneration: "member.rememberGeneration",
  failGeneration: "member.failGeneration",
  forgetGeneration: "member.forgetGeneration",
  completeGeneration: "member.completeGeneration",
  listGenerations: "member.listGenerations",
} as const;
export type MemberMethod = (typeof memberMethods)[keyof typeof memberMethods];

/** Call one member method with its JSON body through the admitted `appMethods` transport. */
export function callMemberMethod(
  capabilities: CapabilityDirectory,
  method: MemberMethod,
  body: string,
): Promise<WhistleJsonValue> {
  return capabilities.require(appMethods).call(method, body);
}
