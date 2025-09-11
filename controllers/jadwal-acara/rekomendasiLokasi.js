const  axios = require("axios");

const rekomendasiLokasi = async(req, res) => {
    try {
    const { q } = req.query;
    const serpApiKey = process.env.SERPAPI_KEY;

    if (!serpApiKey) {
      return res.status(500).json({
        error: 'SerpAPI key not configured in backend environment variables'
      });
    }

    if (!q) {
      return res.status(400).json({
        error: 'Query parameter "q" is required'
      });
    }

    // Panggil SerpAPI
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google_maps',
        q: q,
        api_key: serpApiKey,
        ll: '@-7.3279,108.2200,12z',
        limit: 5
      }
    });

    // Filter hanya data yang dibutuhkan untuk mengurangi ukuran response
    const filteredResults = response.data.local_results?.slice(0, 5).map(item => ({
      title: item.title,
      address: item.address,
      place_id: item.place_id,
      coordinates: item.coordinates,
      rating: item.rating,
      reviews: item.reviews
    })) || [];

    res.json({
      local_results: filteredResults,
      search_parameters: response.data.search_parameters
    });

  } catch (error) {
    console.error('Error fetching recommendations:', error.response?.data || error.message);

    if (error.response) {
      // Error dari SerpAPI
      return res.status(error.response.status).json({
        error: 'Failed to fetch recommendations from location service',
        details: error.response.data
      });
    }

    // Error lainnya
    res.status(500).json({
      error: 'Internal server error while fetching recommendations'
    });
  }
}

module.exports = rekomendasiLokasi