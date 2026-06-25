import google from 'googlethis';

(async () => {
  const options = {
    page: 0, 
    safe: false, 
    parse_ads: false, 
    additional_params: { hl: 'en' }
  };

  const response = await google.search('portugal world cup match latest goals scored minutes', options);
  console.log(response.results);
})();
