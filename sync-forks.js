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
          const upstreamResponse = await octokit.request('GET /repos/{owner}/{repo}', {
            owner: repo.owner.login,
            repo: repo.name
          });

          let upstreamRepo = upstreamResponse.data.upstream;

          if (!upstreamRepo) {
            console.log(`No upstream repository found for ${repo.full_name}. Setting upstream...`);

            // Try to find the original repository using parent information
            if (repo.parent) {
              upstreamRepo = repo.parent;
            } else {
              console.warn(`Parent information missing for ${repo.full_name}. Attempting to infer original repository...`);

              // Attempt to infer the original repository
              const parts = repo.name.split('-');
              const originalRepoName = parts.slice(0, -1).join('-'); // Remove the last part assuming it's a suffix
              const originalOwner = repo.owner.login; // Assume the same owner for simplicity

              try {
                const originalRepoResponse = await octokit.request('GET /repos/{owner}/{repo}', {
                  owner: originalOwner,
                  repo: originalRepoName
                });
                upstreamRepo = originalRepoResponse.data;
              } catch (err) {
                console.error(`Failed to infer original repository for ${repo.full_name}: ${err.message}`);
                continue;
              }
            }

            if (!upstreamRepo) {
              console.error(`Failed to find original repository for ${repo.full_name}`);
              continue;
            }

            // Add the upstream repository
            try {
              await octokit.request('POST /repos/{owner}/{repo}/remotes', {
                owner: repo.owner.login,
                repo: repo.name,
                name: 'upstream',
                url: upstreamRepo.clone_url
              });
              console.log(`Upstream set for ${repo.full_name}`);
            } catch (err) {
              console.error(`Failed to set upstream for ${repo.full_name}: ${err.message}`);
              continue;
            }
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
