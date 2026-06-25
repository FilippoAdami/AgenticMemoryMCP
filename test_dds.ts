import { search } from 'duck-duck-scrape';

(async () => {
  const searchResults = await search('latest worlds cup game of portugal and ask who scored and at which minutes');
  console.log(searchResults.results);
})();
