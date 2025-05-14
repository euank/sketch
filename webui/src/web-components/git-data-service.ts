// git-data-service.ts
// Interface and implementation for fetching Git data

/**
 * Represents a Git commit entry
 */
export interface GitCommit {
  hash: string;
  subject: string;
  refs?: string[];
}

/**
 * Represents a file in a Git diff
 */
export interface GitDiffFile {
  path: string;
  status: string; // 'A'=added, 'M'=modified, 'D'=deleted, 'R'=renamed
  oldPath?: string; // For renamed files
  oldMode?: string;
  newMode?: string;
  oldHash?: string;
  newHash?: string;
}

/**
 * Interface for Git data services
 */
export interface GitDataService {
  /**
   * Fetches recent commit history
   * @param initialCommit The initial commit hash to start from
   * @returns List of commits
   */
  getCommitHistory(initialCommit?: string): Promise<GitCommit[]>;

  /**
   * Fetches diff between two commits
   * @param from Starting commit hash
   * @param to Ending commit hash
   * @returns List of changed files
   */
  getDiff(from: string, to: string): Promise<GitDiffFile[]>;

  /**
   * Fetches diff for a single commit
   * @param commit Commit hash
   * @returns List of changed files
   */
  getCommitDiff(commit: string): Promise<GitDiffFile[]>;

  /**
   * Fetches file content at a specific commit
   * @param commit Commit hash
   * @param path File path
   * @returns File content as string
   */
  getFileContent(commit: string, path: string): Promise<string>;

  /**
   * Gets the base commit reference (often "sketch-base")
   * @returns Base commit reference
   */
  getBaseCommitRef(): Promise<string>;
}

/**
 * Default implementation of GitDataService for the real application
 */
export class DefaultGitDataService implements GitDataService {
  private baseCommitRef: string | null = null;

  async getCommitHistory(initialCommit?: string): Promise<GitCommit[]> {
    try {
      const url = initialCommit 
        ? `git/recentlog?initialCommit=${encodeURIComponent(initialCommit)}` 
        : 'git/recentlog';
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch commit history: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching commit history:', error);
      throw error;
    }
  }

  async getDiff(from: string, to: string): Promise<GitDiffFile[]> {
    try {
      const url = `git/rawdiff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch diff: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching diff:', error);
      throw error;
    }
  }

  async getCommitDiff(commit: string): Promise<GitDiffFile[]> {
    try {
      const url = `git/rawdiff?commit=${encodeURIComponent(commit)}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch commit diff: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching commit diff:', error);
      throw error;
    }
  }

  async getFileContent(commit: string, path: string): Promise<string> {
    try {
      const url = `git/show?hash=${encodeURIComponent(commit)}:${encodeURIComponent(path)}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch file content: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.output || '';
    } catch (error) {
      console.error('Error fetching file content:', error);
      throw error;
    }
  }

  async getBaseCommitRef(): Promise<string> {
    // Cache the base commit reference to avoid multiple requests
    if (this.baseCommitRef) {
      return this.baseCommitRef;
    }

    try {
      // This could be replaced with a specific endpoint call if available
      // For now, we'll use a fixed value or try to get it from the server
      this.baseCommitRef = 'sketch-base';
      return this.baseCommitRef;
    } catch (error) {
      console.error('Error fetching base commit reference:', error);
      throw error;
    }
  }
}

// No need for global interface declaration as we're using proper dependency injection