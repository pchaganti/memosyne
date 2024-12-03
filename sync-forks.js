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

  async function syncForks() {
    try {
      let page = 1;
      let perPage = 100;
      let repos = [];

      // Fetch all forks
      while (true) {
        const response = await octokit.request('GET /user/repos?type=forks&per_page={perPage}&page={page}', {
          perPage: perPage,
          page: page
        });
        if (response.data.length === 0) break;
        repos = repos.concat(response.data);
        page++;
      }

      for (const repo of repos) {
        console.log(`Syncing fork: ${repo.full_name}`);
        try {
          await octokit.request('POST /repos/{owner}/{repo}/merge-upstream', {
            owner: repo.owner.login,
            repo: repo.name,
            merge_ref: 'main',  // Adjust if your default branch is not 'main'
          });
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
