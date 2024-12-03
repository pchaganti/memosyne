// sync-forks.js
(async () => {
  const { Octokit } = await import('@octokit/core');
  const { restEndpointMethods } = await import('@octokit/plugin-rest-endpoint-methods');
  const fetch = await import('node-fetch').then(mod => mod.default);

  const MyOctokit = Octokit.plugin(restEndpointMethods);

  const octokit = new MyOctokit({
    auth: process.env.PERSONAL_ACCESS_TOKEN,
    request: {
      fetch: fetch
    }
  });

  async function getUpstreamRepository(owner, repoName) {
    try {
      const response = await octokit.request('GET /repos/{owner}/{repo}', {
        owner: owner,
        repo: repoName
      });
      const repoData = response.data;
      if (repoData.parent) {
        return repoData.parent;
      }
      return null;
    } catch (err) {
      console.error(`Failed to fetch repository information for ${owner}/${repoName}: ${err.message}`);
      return null;
    }
  }

  async function getDefaultBranch(owner, repoName) {
    try {
      const response = await octokit.request('GET /repos/{owner}/{repo}', {
        owner: owner,
        repo: repoName
      });
      const repoData = response.data;
      return repoData.default_branch;
    } catch (err) {
      console.error(`Failed to fetch default branch for ${owner}/${repoName}: ${err.message}`);
      return null;
    }
  }

  async function syncForks() {
    try {
      let page = 1;
      let perPage = 100;
      let repos = [];

      // Fetch all repositories
      while (true) {
        const response = await octokit.request('GET /user/repos?type=all&per_page={perPage}&page={page}', {
          perPage: perPage,
          page: page
        });
        if (response.data.length === 0) break;
        repos = repos.concat(response.data);
        page++;
      }

      // Filter only forks
      const forks = repos.filter(repo => repo.fork);

      for (const repo of forks) {
        console.log(`Syncing fork: ${repo.full_name}`);

        try {
          // Get the upstream repository information
          const upstreamRepo = await getUpstreamRepository(repo.owner.login, repo.name);

          if (!upstreamRepo) {
            console.warn(`No upstream repository found for ${repo.full_name}. Skipping sync.`);
            continue;
          }

          // Get the default branch of the fork
          const defaultBranch = await getDefaultBranch(repo.owner.login, repo.name);

          if (!defaultBranch) {
            console.warn(`Failed to determine default branch for ${repo.full_name}. Skipping sync.`);
            continue;
          }

          // Clone the fork locally
          const forkDir = `/tmp/${repo.name}`;
          const upstreamUrl = `git@github.com:${upstreamRepo.full_name}.git`;
          const forkUrl = `git@github.com:${repo.full_name}.git`;

          // Remove the directory if it exists
          await exec(`rm -rf ${forkDir}`);
          await exec(`mkdir -p ${forkDir}`);
          process.chdir(forkDir);

          // Clone the fork
          await exec(`git clone ${forkUrl} .`);
          await exec(`git remote add upstream ${upstreamUrl}`);

          // Fetch and merge upstream changes
          await exec(`git fetch upstream`);
          await exec(`git checkout ${defaultBranch}`);
          await exec(`git merge upstream/${upstreamRepo.default_branch} --no-edit`);

          // Push changes back to the fork
          await exec(`git push origin ${defaultBranch}`);

          console.log(`Successfully synced ${repo.full_name}`);
        } catch (err) {
          console.error(`Failed to sync ${repo.full_name}: ${err.message}`);
        }
      }
    } catch (error) {
      console.error('Error fetching forks:', error.message);
    }
  }

  function exec(command) {
    return new Promise((resolve, reject) => {
      const { exec: execCommand } = require('child_process');
      execCommand(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  syncForks();
})();
