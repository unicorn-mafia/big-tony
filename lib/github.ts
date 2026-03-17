import { Octokit } from "@octokit/rest";
import yaml from "js-yaml";

import type { Member, MembersYaml } from "../types/membersdb";
import { GoogleContactsService, type GoogleContactSyncResult } from "./googleContacts";

export interface SubmitResult {
  status: "pr_open" | "pr_exists" | "error";
  pr_url?: string;
  branch?: string;
  message: string;
  google_contacts?: GoogleContactSyncResult;
}

export class GitHubService {
  private octokit: Octokit;
  private repoOwner: string;
  private repoName: string;
  private defaultBranch: string;

  constructor() {
    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.REPO_OWNER;
    const repo = process.env.REPO_NAME;

    if (!token) {
      throw new Error("GITHUB_TOKEN environment variable is not set");
    }
    if (!owner) {
      throw new Error("REPO_OWNER environment variable is not set");
    }
    if (!repo) {
      throw new Error("REPO_NAME environment variable is not set");
    }

    this.octokit = new Octokit({ auth: token });
    this.repoOwner = owner;
    this.repoName = repo;
    this.defaultBranch = process.env.DEFAULT_BRANCH || "main";

    console.log(`GitHubService initialized for ${this.repoOwner}/${this.repoName}`);
  }

  private normalizeGitHubUsername(github: string): string {
    return github.startsWith("https://github.com/")
      ? github.replace("https://github.com/", "")
      : github;
  }

  private normalizeGitHubUrl(github: string): string {
    return github.startsWith("https://github.com/")
      ? github
      : `https://github.com/${github}`;
  }

  async checkGitHubUser(username: string): Promise<boolean> {
    try {
      const normalized = this.normalizeGitHubUsername(username);
      await this.octokit.users.getByUsername({ username: normalized });
      return true;
    } catch {
      return false;
    }
  }

  async checkPRExists(githubUsername: string): Promise<{ exists: boolean; url: string }> {
    const normalized = this.normalizeGitHubUsername(githubUsername);
    try {
      const { data: prs } = await this.octokit.pulls.list({
        owner: this.repoOwner,
        repo: this.repoName,
        state: "open",
      });

      for (const pr of prs) {
        if (pr.head.ref.includes(`join/${normalized}`)) {
          return { exists: true, url: pr.html_url };
        }
      }
      return { exists: false, url: "" };
    } catch (error) {
      console.error(`Failed to list PRs for ${this.repoOwner}/${this.repoName}:`, error);
      throw new Error(
        `Cannot access repository ${this.repoOwner}/${this.repoName}. ` +
        `Check that REPO_OWNER and REPO_NAME are correct, and GITHUB_TOKEN has repo access.`
      );
    }
  }

  async getMemberByPhone(phone_e164: string): Promise<Member | undefined> {
    const { data: fileContent } = await this.octokit.repos.getContent({
      owner: this.repoOwner,
      repo: this.repoName,
      path: 'members.yaml',
      ref: this.defaultBranch,
    });

    if ("content" in fileContent) {
      const decoded = Buffer.from(fileContent.content, "base64").toString("utf-8");
      const existingYaml = yaml.load(decoded) as MembersYaml;
      for (const member of existingYaml.members) {
        if (member.phone === phone_e164) {
          return member;
        }
      }
      return undefined;
    }
  }

  async createMemberPR(memberData: Member): Promise<SubmitResult> {
    const github = this.normalizeGitHubUrl(memberData.social.github);
    const githubUsername = this.normalizeGitHubUsername(memberData.social.github);
    const slug = githubUsername.toLowerCase();
    const today = new Date().toISOString().split("T")[0];
    const branchName = `join/${slug}-${today.replace(/-/g, "")}-${Math.random().toString(36).substring(2, 6)}`;

    // Check if PR already exists
    const { exists: prExists, url: prUrl } = await this.checkPRExists(githubUsername);
    if (prExists) {
      const googleContacts = new GoogleContactsService();
      const syncResult = await googleContacts.syncMemberContact(memberData, prUrl);
      return {
        status: "pr_exists",
        pr_url: prUrl,
        message: this.withGoogleContactNotification("PR already exists.", syncResult),
        google_contacts: syncResult,
      };
    }

    // Get base branch SHA
    const { data: baseBranch } = await this.octokit.repos.getBranch({
      owner: this.repoOwner,
      repo: this.repoName,
      branch: this.defaultBranch,
    });

    // Create branch
    try {
      await this.octokit.git.createRef({
        owner: this.repoOwner,
        repo: this.repoName,
        ref: `refs/heads/${branchName}`,
        sha: baseBranch.commit.sha,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Reference already exists")) {
        throw error;
      }
    }

    // Build member object
    const newMember = {
      name: memberData.name,
      phone: memberData.phone,
      current_job: {
        role: memberData.current_job.role,
        company: memberData.current_job.company,
      },
      social: {
        github: github,
        linkedin: memberData.social.linkedin || undefined,
      },
      joined_date: today,
      referer_name: memberData.referer_name || undefined,
    } as Member;

    // Get existing members.yaml or create new
    const filePath = "members.yaml";
    let existingYaml: { members: unknown[] } = { members: [] };
    let fileSha: string | undefined;

    try {
      const { data: fileContent } = await this.octokit.repos.getContent({
        owner: this.repoOwner,
        repo: this.repoName,
        path: filePath,
        ref: this.defaultBranch,
      });

      if ("content" in fileContent) {
        const decoded = Buffer.from(fileContent.content, "base64").toString("utf-8");
        existingYaml = (yaml.load(decoded) as { members: unknown[] }) || { members: [] };
        if (!existingYaml.members) {
          existingYaml.members = [];
        }
        fileSha = fileContent.sha;
      }
    } catch {
      // File doesn't exist, use empty members array
    }

    existingYaml.members.push(newMember);
    const yamlContent = yaml.dump(existingYaml, { sortKeys: false });

    // Create or update file
    if (fileSha) {
      await this.octokit.repos.createOrUpdateFileContents({
        owner: this.repoOwner,
        repo: this.repoName,
        path: filePath,
        message: `Add member: ${memberData.name}`,
        content: Buffer.from(yamlContent).toString("base64"),
        sha: fileSha,
        branch: branchName,
      });
    } else {
      await this.octokit.repos.createOrUpdateFileContents({
        owner: this.repoOwner,
        repo: this.repoName,
        path: filePath,
        message: `Add member: ${memberData.name}`,
        content: Buffer.from(yamlContent).toString("base64"),
        branch: branchName,
      });
    }

    // Create PR
    const prBody = `Requested via WhatsApp onboarding.

- Name: ${memberData.name}
- GitHub: ${github}
- LinkedIn: ${memberData.social.linkedin}
- Role: ${memberData.current_job.role}
- Company: ${memberData.current_job.company}
- Referer: ${memberData.referer_name}
- Source: whatsapp

Reviewer checklist:
- [ ] Links resolve
- [ ] Role/company look sane`;

    const { data: pr } = await this.octokit.pulls.create({
      owner: this.repoOwner,
      repo: this.repoName,
      title: `Add member: ${memberData.name}`,
      body: prBody,
      head: branchName,
      base: this.defaultBranch,
    });

    const googleContacts = new GoogleContactsService();
    const syncResult = await googleContacts.syncMemberContact(newMember, pr.html_url);

    return {
      status: "pr_open",
      pr_url: pr.html_url,
      branch: branchName,
      message: this.withGoogleContactNotification("PR created successfully.", syncResult),
      google_contacts: syncResult,
    };
  }

  private withGoogleContactNotification(
    baseMessage: string,
    syncResult: GoogleContactSyncResult
  ): string {
    return `${baseMessage} ${syncResult.message}`;
  }
}
