// git-data-service.ts
// Interface and implementation for fetching Git data

import { DiffFile, GitLogEntry } from '../types';

// Re-export DiffFile as GitDiffFile
export type GitDiffFile = DiffFile;

/**
 * Interface for Git data services
 */
export interface GitDataService {
  /**
   * Fetches recent commit history
   * @param initialCommit The initial commit hash to start from
   * @returns List of commits
   */
  getCommitHistory(initialCommit?: string): Promise<GitLogEntry[]>;

  /**
   * Fetches diff between two commits
   * @param from Starting commit hash
   * @param to Ending commit hash (can be empty string for unstaged changes)
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
   * Fetches file content from git using a file hash
   * @param fileHash Git blob hash of the file to fetch
   * @returns File content as string
   */
  getFileContent(fileHash: string): Promise<string>;

  /**
   * Gets file content from the current working directory
   * @param filePath Path to the file within the repository
   * @returns File content as string
   */
  getWorkingCopyContent(filePath: string): Promise<string>;
  
  /**
   * Saves file content to the working directory
   * @param filePath Path to the file within the repository
   * @param content New content to save to the file
   */
  saveFileContent(filePath: string, content: string): Promise<void>;

  /**
   * Gets the base commit reference (often "sketch-base")
   * @returns Base commit reference
   */
  getBaseCommitRef(): Promise<string>;

  /**
   * Fetches unstaged changes (diff between a commit and working directory)
   * @param from Starting commit hash (defaults to HEAD if not specified)
   * @returns List of changed files
   */
  getUnstagedChanges(from?: string): Promise<GitDiffFile[]>;
}

/**
 * Default implementation of GitDataService for the real application
 */
export class DefaultGitDataService implements GitDataService {
  private baseCommitRef: string | null = null;

  async getCommitHistory(initialCommit?: string): Promise<GitLogEntry[]> {
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

  async getFileContent(fileHash: string): Promise<string> {
    try {
      // If the hash is marked as a working copy (special value '000000' or empty)
      if (fileHash === '0000000000000000000000000000000000000000' || !fileHash) {
        // This shouldn't happen, but if it does, return empty string
        // Working copy content should be fetched through getWorkingCopyContent
        console.warn('Invalid file hash for getFileContent, returning empty string');
        return '';
      }
      
      const url = `git/show?hash=${encodeURIComponent(fileHash)}`;
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
  
  async getWorkingCopyContent(filePath: string): Promise<string> {
    try {
      const url = `git/cat?path=${encodeURIComponent(filePath)}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch working copy content: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.output || '';
    } catch (error) {
      console.error('Error fetching working copy content:', error);
      throw error;
    }
  }
  
  async saveFileContent(filePath: string, content: string): Promise<void> {
    try {
      const url = `git/save`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: filePath,
          content: content
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to save file content: ${response.statusText} - ${errorText}`);
      }
      
      // Don't need to return the response, just ensure it was successful
    } catch (error) {
      console.error('Error saving file content:', error);
      throw error;
    }
  }
  
  async getUnstagedChanges(from: string = 'HEAD'): Promise<GitDiffFile[]> {
    try {
      // To get unstaged changes, we diff the specified commit (or HEAD) with an empty 'to'
      return await this.getDiff(from, '');
    } catch (error) {
      console.error('Error fetching unstaged changes:', error);
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