// sync-forks.js
(async () => {
  const { Octokit } = await import('@octokit/core');
  const { restEndpointMethods } = await import('@octokit/plugin-rest-endpoint-methods');
  const fetch = await import('node-fetch').then(mod => mod.default);

  const MyOctokit = Octokit.plugin(restEndpointMethods);

  const octokit = new Octokit({
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

          // Create a pull request from upstream to fork
          const pullRequestResponse = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
            owner: repo.owner.login,
            repo: repo.name,
            title: 'Sync with upstream',
            head: `${upstreamRepo.owner.login}:${upstreamRepo.default_branch}`,
            base: repo.default_branch || 'main'  // Adjust if your default branch is not 'main'
          });

          const pullRequest = pullRequestResponse.data;

          // Merge the pull request
          await octokit.request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', {
            owner: repo.owner.login,
            repo: repo.name,
            pull_number: pullRequest.number,
            commit_message: 'Merge upstream changes'
          });

          console.log(`Successfully synced ${repo.full_name}`);
        } catch (err) {
          console.error(`Failed to sync ${repo.full_name}: ${err.message}`);
        }
      }
    } catch (error) {
      console.error('Error fetching forks:', error.message);
    }
  }

  syncForks();
})();
