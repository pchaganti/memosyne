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

  async function getUpstreamFromDescription(repo) {
    const description = repo.description.toLowerCase();
    const regex = /upstream:\s*https:\/\/github\.com\/([^\/]+)\/([^\/]+)/;
    const match = description.match(regex);
    if (match) {
      return { owner: match[1], name: match[2] };
    }
    return null;
  }

  async function getUpstreamFromTopics(repo) {
    const topics = repo.topics || [];
    for (const topic of topics) {
      if (topic.startsWith('upstream:')) {
        const parts = topic.split(':');
        if (parts.length === 3) {
          return { owner: parts[1], name: parts[2] };
        }
      }
    }
    return null;
  }

  async function findUpstreamRepository(repo) {
    // Check if parent information is available
    if (repo.parent) {
      return repo.parent;
    }

    // Attempt to infer upstream from description
    const upstreamFromDescription = await getUpstreamFromDescription(repo);
    if (upstreamFromDescription) {
      return upstreamFromDescription;
    }

    // Attempt to infer upstream from topics
    const upstreamFromTopics = await getUpstreamFromTopics(repo);
    if (upstreamFromTopics) {
      return upstreamFromTopics;
    }

    // If all methods fail, return null
    return null;
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
          const upstreamResponse = await octokit.request('GET /repos/{owner}/{repo}', {
            owner: repo.owner.login,
            repo: repo.name
          });

          let upstreamRepo = upstreamResponse.data.upstream;

          if (!upstreamRepo) {
            console.log(`No upstream repository found for ${repo.full_name}. Inferring upstream...`);

            // Attempt to find the original repository
            upstreamRepo = await findUpstreamRepository(repo);

            if (!upstreamRepo) {
              console.warn(`Failed to infer upstream repository for ${repo.full_name}. Skipping sync.`);
              continue;
            }

            // Fetch the upstream repository details
            try {
              const upstreamDetailsResponse = await octokit.request('GET /repos/{owner}/{repo}', {
                owner: upstreamRepo.owner,
                repo: upstreamRepo.name
              });
              upstreamRepo = upstreamDetailsResponse.data;
            } catch (err) {
              console.error(`Failed to fetch upstream repository details for ${repo.full_name}: ${err.message}`);
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
