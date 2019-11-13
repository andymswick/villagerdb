const express = require('express');
const router = express.Router();

/**
 * Number of entities per page on any result page.
 *
 * @type {number}
 */
const pageSize = 25;

/**
 * All possible filters
 *
 * @type {{}}
 */
const allFilters = {
    gender: {
        name: 'Gender',
        values: {male: 'Male', female: 'Female'}
    },
    game: {
        name: 'Games',
        values: {
            'nl': 'New Leaf',
            'cf': 'City Folk',
            'ww': 'Wild World',
            'afe+': 'Animal Forest e+',
            'ac': 'Animal Crossing',
            'af+': 'Animal Forest+',
            'af': 'Animal Forest'
        }
    },
    personality: {
        name: 'Personality',
        values: {
            cranky: 'Cranky',
            jock: 'Jock',
            lazy: 'Lazy',
            normal: 'Normal',
            peppy: 'Peppy',
            smug: 'Smug',
            snooty: 'Snooty',
            uchi: 'Uchi'
        }
    },
    species: {
        name: 'Species',
        values: {
            alligator: 'Alligator',
            anteater: 'Anteater',
            bear: 'Bear',
            bird: 'Bird',
            bull: 'Bull',
            cat: 'Cat',
            chicken: 'Chicken',
            cow: 'Cow',
            cub: 'Cub',
            deer: 'Deer',
            dog: 'Dog',
            duck: 'Duck',
            eagle: 'Eagle',
            elephant: 'Elephant',
            frog: 'Frog',
            goat: 'Goat',
            gorilla: 'Gorilla',
            hamster: 'Hamster',
            hippo: 'Hippo',
            horse: 'Horse',
            kangaroo: 'Kangaroo',
            koala: 'Koala',
            lion: 'Lion',
            monkey: 'Monkey',
            mouse: 'Mouse',
            octopus: 'Octopus',
            ostrich: 'Ostrich',
            penguin: 'Penguin',
            pig: 'Pig',
            rabbit: 'Rabbit',
            rhino: 'Rhino',
            sheep: 'Sheep',
            squirrel: 'Squirrel',
            tiger: 'Tiger',
            wolf: 'Wolf',
        }
    }
};

/**
 * The aggregations we want.
 *
 * @type {{}}
 */
const aggregations = {
    gender: {
        terms: {
            field: 'gender',
            size: 2
        }
    },
    personality: {
        terms: {
            field: 'personality',
            size: 50
        }
    },
    species: {
        terms: {
            field: 'species',
            size: 50
        }
    },
    game: {
        terms: {
            field: 'game',
            size: 50
        }
    }/*,
    zodiac: {
        terms: {
            field: 'zodiac',
            size: 50
        }
    }*/
};

/**
 * Transform URL parameters into applied filters that can be used by the frontend and by the getFacetQuery function
 * here.
 *
 * @param params
 */
function getAppliedFilters(params) {
    const appliedFilters = {};
    for (let key in params) {
        // Is it a valid filter?
        if (allFilters[key]) {
            // Does it have values?
            const values = params[key].split(',');
            if (values.length > 0) {
                // Set them.
                appliedFilters[key] = values;
            }
        }
    }

    return appliedFilters;
}

/**
 * Get match queries for the applied filters. Returns an empty array if there is nothing to send.
 *
 * @param appliedFilters
 * @returns {[]}
 */
function getFacetQuery(appliedFilters) {
    const outerQueries = [];
    for (let key in appliedFilters) {
        const innerQueries = [];
        for (let value of appliedFilters[key]) {
            const query = {};
            query.match = {};
            query.match[key] = {
                query: value
            };
            innerQueries.push(query);
        }
        outerQueries.push({
            bool: {
                should: innerQueries
            }
        });
    }

    return outerQueries;
}

/**
 * Restricts the available filters to things that won't result in a "no results" response from ElasticSearch.
 *
 * @param appliedFilters
 * @param aggregations
 */
function buildAvailableFilters(appliedFilters, aggregations) {
    const availableFilters = {};

    for (let key in aggregations) {
        // If this filter is applied, we show all available options.
        if (appliedFilters[key]) {
            availableFilters[key] = allFilters[key];
        } else {
            // Only show what the aggregation allows.
            const buckets = aggregations[key].buckets;
            if (buckets.length > 0) {
                const bucketKeyValue = {};
                for (let b of buckets) {
                    bucketKeyValue[b.key] = allFilters[key].values[b.key];
                }

                availableFilters[key] = {
                    name: allFilters[key].name,
                    values: bucketKeyValue
                };
            }
        }
    }
    return availableFilters;
}

/**
 * Load villagers on a particular page number with a particular search query.
 *
 * @param collection collection of villagers from Mongo
 * @param es
 * @param pageNumber the already sanity checked page number
 * @param searchQuery
 * @returns {Promise<void>}
 */
async function find(collection, es, pageNumber, searchQuery, params) {
    const result = {};

    result.appliedFilters = getAppliedFilters(params);

    // Build ES query for applied filters, if any.
    const facetQuery = getFacetQuery(result.appliedFilters);

    // Is it a search? Initialize result and ES body appropriately
    let body;
    let query;
    if (searchQuery) {
        // Disallow queries of length greater than 64
        if (searchQuery.length > 64) {
            let e = new Error('Request query too long');
            e.status = 400;
            throw e;
        }

        // Set up result set for search display
        result.pageUrlPrefix = '/villagers/search/page/';
        result.isSearch = true;
        result.searchQuery = searchQuery;
        result.searchQueryString = encodeURIComponent(searchQuery);

        // Elastic Search query and body.
        const searchStringQuery = [
            {
                match: {
                    name: {
                        query: searchQuery
                    }
                }
            },
            {
                match: {
                    phrase: {
                        query: searchQuery,
                        fuzziness: 'auto'
                    }
                }
            }
        ];

        if (facetQuery.length > 0) {
            query = {
                bool: {
                    must: [
                        {
                            bool: {
                                should: searchStringQuery
                            }
                        },
                        {
                            bool: {
                                must: facetQuery
                            }
                        }
                    ]
                }
            };
        } else {
            query = {
                bool: {
                    should: searchStringQuery
                }
            };
        }

        body =  {
            sort: [
                "_score",
                {
                    keyword: "asc"
                }
            ],
            query: query,
            aggregations: aggregations
        };
    } else {
        result.pageUrlPrefix = '/villagers/page/';

        // Elastic Search query and body.
        if (facetQuery.length > 0) {
            query = {
                bool: {
                    must: facetQuery
                }
            };
        } else {
            query = {
                match_all: {}
            };
        }

        body = {
            sort: [
                {
                    keyword: "asc"
                }
            ],
            query: query,
            aggregations: aggregations
        }
    }

    // Count.
    const totalCount = await es.count({
        index: 'villager',
        body: {
            query: query
        }
    });

    // Update page information.
    computePageProperties(pageNumber, pageSize, totalCount.count, result);

    result.results = [];
    if (totalCount.count > 0) {
        // Load all on this page.
        const results = await es.search({
            index: 'villager',
            from: pageSize * (result.currentPage - 1),
            size: pageSize,
            body: body
        });

        // Load the results.
        result.availableFilters =  buildAvailableFilters(result.appliedFilters, results.aggregations);

        const keys = results.hits.hits.map(hit => hit._id);
        const rawResults = await collection.getByIds(keys);
        for (let r of rawResults) {
            result.results.push({
                id: r.id,
                name: r.name
            });
        }
    }

    return result;
}



/**
 * Return the given input as a parsed integer if it is a positive integer. Otherwise, return 1.
 *
 * @param value
 * @returns {number}
 */
function parsePositiveInteger(value) {
    const parsedValue = parseInt(value);
    if (Number.isNaN(parsedValue) || parsedValue < 1) {
        return 1;
    }

    return parsedValue;
}

/**
 * Do pagination math.
 *
 * @param pageNumber
 * @param pageSize
 * @param totalCount
 * @param result
 */
function computePageProperties(pageNumber, pageSize, totalCount, result) {
    // Totals
    result.totalCount = totalCount;
    result.totalPages = Math.ceil(totalCount / pageSize);

    // Clean up page number.
    if (pageNumber < 1) {
        pageNumber = 1;
    } else if (pageNumber > result.totalPages) {
        pageNumber = result.totalPages;
    }

    // Pagination specifics
    result.currentPage = pageNumber;
    result.startIndex = (pageSize * (pageNumber - 1) + 1);
    result.endIndex = (pageSize * pageNumber) > totalCount ? totalCount :
        (pageSize * pageNumber);
}

/**
 * Search pages entry point.
 *
 * @param searchQuery
 */
function listVillagers(res, next, pageNumber, isAjax, params) {
    const data = {};
    const searchQuery = typeof params.q === 'string' ? params.q.trim() : undefined;
    if (searchQuery) {
        data.pageTitle = 'Search results for ' + searchQuery; // template engine handles HTML escape
    } else {
        data.pageTitle = 'All Villagers - Page ' + pageNumber;
    }

    find(res.app.locals.db.villagers, res.app.locals.es, pageNumber, searchQuery, params)
        .then((result) => {
            if (isAjax) {
                res.send(result);
            } else {
                res.app.locals.db.birthdays.getBirthdays()
                    .then((birthdays) => {
                        data.birthdays = birthdays;
                        data.shouldDisplayBirthdays = birthdays.length > 0;
                        data.initialState = JSON.stringify(result);
                        data.result = result;
                        res.render('villagers', data);
                    })
                    .catch(next);
            }
        })
        .catch(next);
}

/* GET villagers listing. */
router.get('/', function (req, res, next) {
    listVillagers(res, next, 1, req.query.isAjax === 'true', req.query);
});

/* GET villagers page number */
router.get('/page/:pageNumber', function (req, res, next) {
    listVillagers(res, next, parsePositiveInteger(req.params.pageNumber), req.query.isAjax === 'true',
        req.query);
});

/* GET villagers search */
/*router.get('/search', function (req, res, next) {
    listVillagers(res, next, 1, req.query.isAjax === 'true', parseQuery(req.query.q));
});*'

/* GET villagers search page number */
/*router.get('/search/page/:pageNumber', function (req, res, next) {
    listVillagers(res, next, parsePositiveInteger(req.params.pageNumber), req.query.isAjax === 'true', parseQuery(req.query.q));
});*/

router.get('/autocomplete', function (req, res, next) {
    // Validate query
    if (typeof req.query.q !== 'string' || req.query.q.length > 64) {
        const e = new Error('Invalid request.');
        e.status = 400; // Bad Request
        throw e;
    }

    res.app.locals.es.search({
        index: 'villager',
        body: {
            suggest: {
                villager: {
                    prefix: req.query.q,
                    completion: {
                        field: 'suggest',
                        size: 5
                    }
                }
            }
        }
    })
        .then((results) => {
            const suggestions = [];
            if (results.suggest && results.suggest.villager) {
                for (let x of results.suggest.villager) {
                    for (let y of x.options) {
                        suggestions.push(y.text);
                    }
                }
            }
            res.send(suggestions);
        })
        .catch(next);

});

module.exports = router;