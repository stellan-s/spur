import { RepositoryError } from "./errors";
import type { SourceProvider } from "./source-provider";

export class UnconnectedSource implements SourceProvider {
  readonly root = "";

  async metadata() { return { name: "No connected repository", commitSha: "", remoteUrl: null }; }
  async listFilesAtCommit(): Promise<never> { throw new RepositoryError("No repository is connected."); }
  async searchFilesAtCommit(): Promise<never> { throw new RepositoryError("No repository is connected."); }
  async readFileAtCommit(): Promise<never> { throw new RepositoryError("No repository is connected."); }
  async readLinesAtCommit(): Promise<never> { throw new RepositoryError("No repository is connected."); }
  async hasCommit() { return false; }
  async verifyExcerpt() { return false; }
  async checkExcerpt() { return { ok: false as const, reason: "No repository is connected." }; }
}
