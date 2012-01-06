(function () {

    "use strict";
    var ANIMATION_DURATION = 650;

    function ElasticList(data, target/*, options, callback*/) {
        switch (arguments.length) {
            case 3:
                if (typeof arguments[2] === 'function') {
                    this._callback = arguments[2];
                } else {
                    this._options = arguments[2];
                }
                break;
            case 4:
                this._options = arguments[2];
                this._callback = arguments[3];
                break;
        }

        this._facets = data.facets;
        this._target = target;
        this._options = jQuery.extend({}, ElasticList.defaultOptions, this._options);
        this._facetMap = {};
        this._searchQuery = [];
        this._workingSearchQuery = [];     // list of all selected criteria (i.e. the ones we have clicked on).
        this._workingSearchQueryMap = {};  // Map between search query index and criterion id 

        this._data = {
            facets: {},
            criteria: {},
            items: data.items
        };

        this._container = document.createElement('ul');
        this._container.className = 'elasticList';

        this.draw();
    }
  
    ElasticList.defaultOptions = {
        effect: 'arrange',
        showHeaders: true
    };
    
    ElasticList.prototype = {
        iterate: function(list, fn) {
            var i, len;

            if (!list) {
                return;
            }

            for (i = 0, len = list.length; i < len; i++) {
                if (!!fn.call(this, list[i], i)) { 
                    break;
                }
            }
        },
        iterateFacets: function (fn) {
            var i, len;

            for (i = 0, len = this._facets.length; i < len; i++) {
                fn.call(this, this._facets[i], i);
            }
        },
        iterateItems: function (fn) {
            var i, len;

            for (i = 0, len = this._data.items.length; i < len; i++) {
                fn.call(this, this._data.items[i], i);
            }
        },
        iterateCriteria: function (fn) {
            var cr;

            for (cr in this._data.criteria) {
                fn.call(this, this._data.criteria[cr]);
            }
        },
        iterateCriteriaIds: function (fn) {
            var i, len;

            for (i = 0, len = this._criteriaIds.length; i < len; i++) {
                fn.call(this, this._criteriaIds[i], i);
            }
        },
        draw: function () {
            var criteriaArr,
                criterionGuid = 1,
                criterionToGuidMap = {},
                criterionId,
                criterion,
                fragment,
                fct;
             
            // For every facet, create an array which will contain its criteria
            this.iterateFacets(function (facet) {
                this._data.facets[facet.name] = [];
            });

            // Iterate over every item
            this.iterateItems(function (item, index) {
                // Iterate over every facet
                this.iterateFacets(function (facet) {
                    criteriaArr = item[facet.name] instanceof Array ? item[facet.name] : [item[facet.name]];

                    this.iterate(criteriaArr, function(criterionStr) {
                        if (!criterionToGuidMap[criterionStr]) {
                            criterionToGuidMap[criterionStr] = criterionGuid++; // Create a new guid representing each unique criterion
                        }

                        criterionId = criterionToGuidMap[criterionStr];

                        // If the criterion does not already exists, create a new record for it.  That is,
                        // <this._data.criteria[/*guid of the criterion*/]> stores
                        //  - the text representation of the criterion
                        //  - the list of all itemsIndices of items which have that criterion
                        //  - the name of the facet the criterion belongs to
                        criterion = this._data.criteria[criterionId];
                        if (!criterion) {
                            criterion  = this._data.criteria[criterionId] = {
                                id: criterionId,
                                text: criterionStr,
                                itemsIndices: [],
                                facetName: facet.name
                            };
                        }
                        criterion.itemsIndices.push(index);

                        
                        // Add the criterion id to its facet
                        if (this._data.facets[facet.name].indexOf(criterionId) === -1) {
                            this._data.facets[facet.name].push(criterionId);
                        }
                    });
                });
            });

            // Sort the items' indices in every criterion, thus making searching much faster (and possible) 
            // when using the <findIntersection()> function.
            this.iterateCriteria(function (crterion) {
                crterion.itemsIndices.sort(function (a, b) {
                    return a - b;
                });
            });

            this.onSelectionChanged$proxy = jQuery.proxy(this.onSelectionChanged, this);

            // build
            fragment = document.createDocumentFragment();

            var width = Math.floor(100/this._facets.length);

            var fdraw = [];
            this.iterateFacets(function (facet) {
                fct = new Facet(facet, this._data, this._options);
                this._facetMap[facet.name] = fct;
                jQuery(fct).bind('selectionChanged', this.onSelectionChanged$proxy);
                var d = fct.draw();
                fdraw.push(d);
                fragment.appendChild(d);
            });

            this._container.appendChild(fragment);
            this._target.appendChild(this._container);
        },
        onSelectionChanged: function (e, args) {
            //console.log(args.criterion);
            var i, searchQueryLen, criteriaIds = [], searchItemsIndices = [];

            // If an unhighlighted criterion was selected, clear the query result 
            // and the current list of criteria
            this.iterate(args.criteria, function(criterion) {
                if (!criterion.__highlighted) {
                    // If an unhighlighted criterion was selected, clear the query result and the current list of criteria
                    this._criteriaIds = null;
                    this._workingSearchQuery = [];
                    this._workingSearchQueryMap = {};
                    // Unselect all criteria in every facet
                    this.iterateFacets(function(facet) {
                        if (facet.name !== criterion.facetName) {
                            this._facetMap[facet.name].clearSelection();
                        }
                    });
                    return false; // break
                }
            });

            this.iterate(args.criteria, function(criterion) {
                if (!criterion.__selected) {
                    // If the criterion is deselected, "remove" the criterion from the search query (nullify it)
                    this._workingSearchQuery[this._workingSearchQueryMap[criterion.id]] = null;
                } else {
                    this._workingSearchQuery.push(criterion.id);
                    // Keep a reference of the index, so that if we deselect the criterion we can "remove" it from the search query
                    this._workingSearchQueryMap[criterion.id] = this._workingSearchQuery.length - 1;
                }

                // Compact the array (remove all NULLs) => easy to iterate over
                this._searchQuery = [];
                this.iterate(this._workingSearchQuery, function(searchQuery) {
                    if (searchQuery) {
                        this._searchQuery.push(searchQuery);
                    }
                });

                if (this._searchQuery.length === 0) {
                    this._queryResult = [];
                } else {
                    // Create a list of all items that match the search query.  
                    searchItemsIndices = this._data.criteria[this._searchQuery[0]].itemsIndices;
                    for (i = 1, searchQueryLen = this._searchQuery.length; i < searchQueryLen; i++) {
                        searchItemsIndices = findIntersection(searchItemsIndices, this._data.criteria[this._searchQuery[i]].itemsIndices);
                    }

                    // Iterate over every criteria and find whether any of its items can be found in the searchItemsIndices.
                    this.iterateCriteria(function (criterion) {
                        this.iterate(searchItemsIndices, function(searchItem) {
                            if (criterion.itemsIndices.indexOf(searchItem) !== -1) {
                                criteriaIds.push(criterion.id);
                            }
                        });
                    });
                    
                    // Sort the criteria
                    this._criteriaIds = criteriaIds.sort(function (a, b) {
                        return a - b;
                    });

                    this._queryResult = [];
                        
                    this.iterate(searchItemsIndices, function(searchItem) {
                        this._queryResult.push(this._data.items[searchItem]);
                    });
                }
                if (this._callback) {
                    this._callback(this._queryResult);
                }    
            });

            if (args.criteria.length !== 0) {
                this._highlight(searchItemsIndices);
            }
        },
        _highlight: function (searchItemsIndices) {
            var i, highlightMap = {},
                highlightMapLen = {},
                fct,
                criterionId, facet, result;

            if (this._searchQuery.length === 0) {
                // If there is no search query, all criteria needs to be unhighlighted
                this.iterateCriteriaIds(function (criterionId) {
                    facet = this._data.criteria[criterionId].facetName;
                    if (!highlightMap[facet]) {
                        highlightMap[facet] = {};
                    }
                    highlightMap[facet][criterionId] = 0;
                    highlightMapLen[facet] = 0;
                });
            } else {
                // Highlight the criteria
                this.iterateCriteriaIds(function (criterionId) {
                    result = findIntersection(this._data.criteria[criterionId].itemsIndices, searchItemsIndices);
                    facet = this._data.criteria[criterionId].facetName;

                    if (!highlightMap[facet]) {
                        highlightMap[facet] = {};
                        highlightMapLen[facet] = 0;
                    }
                    if (!highlightMap[facet][criterionId]) {
                        highlightMapLen[facet]++;
                    }
                    highlightMap[facet][criterionId] = result.length;
                });
            }

            for (fct in highlightMap) {
                this._facetMap[fct].highlight(highlightMap[fct], highlightMapLen[fct], true);
            }
        }
    }

    function Facet(facet, data, options) {
        this._facet = facet;
        this._data = data;
        this._criteria = data.facets[facet.name];
        this._options = options;
        this._container = document.createElement('li');
        this._selectedTotal = 0;
        this._sortedCritiera;
        this._$ = jQuery(this);
    }
    Facet.prototype = {
        iterateCriteria: function (fn) {
            var i, len;

            if (!this._sortedCritiera) {
                this._sortedCritiera = [];
                for (i = 0, len = this._criteria.length; i < len; i++) {
                    this._sortedCritiera.push(this._data.criteria[this._criteria[i]]);
                }
                this._sortedCritiera.sort(function(a, b) {
                    return a.text < b.text ? -1 : 1;
                });
            }

            for (i = 0, len = this._sortedCritiera.length; i < len; i++) {
                fn.call(this, this._data.criteria[this._sortedCritiera[i].id], i);
            }
        },
        draw: function () {
            var i, criterion, li, text, count,
                header,
                ul = document.createElement('ul'),
                liFragment = document.createDocumentFragment();

            if (this._options.showHeaders) {
                header = document.createElement('span');
                header.innerHTML = this._facet.text;
                this._container.appendChild(header);
            }

            this._listContainer = document.createElement('div');
            this._$listContainer = jQuery(this._listContainer);

            jQuery(ul).bind('click', $.proxy(this.onCriterionClick, this));

            this.iterateCriteria(function (criterion, index) {
                li = document.createElement('li');
                text = document.createElement('span');
                count = document.createElement('span');

                text.innerHTML = criterion.text;
                count.innerHTML = criterion.itemsIndices.length;

                li.appendChild(text);
                li.appendChild(count);
                li.setAttribute('data-cid', criterion.id);

                liFragment.appendChild(li);

                criterion.dom = jQuery(li);
                criterion.countNode = jQuery(count);
            });

            ul.appendChild(liFragment);
            this._listContainer.appendChild(ul);
            this._container.appendChild(this._listContainer);

            return this._container;
        },
        highlight: function (criteriaTotals, total, animate) {
            this._highlightedTotal = total;
            var highlightedCount = 0,
                selectedCount = 0,
                self = this,
                newIndex, i, criterion, steps;

            // Highlights a criterion
            // @param c: criterion
            function highlight(c) {
                c.__highlighted = true;
                c.dom.addClass('highlighted');
            }

            // Unhighlights a criterion
            // @param c: criterion
            function unhighlight(c) {
                c.__highlighted = false;
                c.dom.removeClass('highlighted');
            }

            // Selected a criterion
            // @param c: criterion
            function select(c) {
                c.__highlighted = true;
                c.dom.addClass('selected');
            }

            // Unselects a criterion
            // @param c: criterion
            function unselect(c) {
                c.__selected = false;
                c.dom.removeClass('selected');
            }

            // Updates a criterion's count
            // @param c: criterion
            function updateCount(c, count) {
                c.countNode.text(count);
            }

            // Resets the height of a criterion's DOM to its original value
            // @param c: criterion
            function resetHeight(c) {
                if (animate) {
                    c.dom.animate({
                        height: this._itemHeight
                    }, 300);
                } else {
                    c.dom.css({
                        height: this._itemHeight
                    });
                }
            }

            // Decreases the height of a criterion's DOM
            // @param c: criterion
            function decreaseHeight(c) {
                if (animate) {
                    c.dom.animate({
                        height: 5
                    }, 300);
                } else {
                    c.dom.css({
                        height: 5
                    });
                }
            }

            // Moves a criterion's DOM to its new location
            // @param c: criterion
            // @param index: current index of the criterion in the list
            // @param steps: number of steps to move, either up or down, in order   
            function move(c, index, steps) {
                var newIndex = index + steps;
                if (c.__index !== newIndex) {
                    c.__index = newIndex;
                    if (animate) {
                        c.dom.animate({
                            top: this._itemOuterHeight * steps
                        }, ANIMATION_DURATION);
                    } else {
                        c.dom.css({
                            top: this._itemOuterHeight * steps
                        });
                    }
                }
            }

            switch (this._options.effect) {
                case 'accordion':

                    if (!this._itemHeight) {
                        this._itemHeight = this._data.criteria[this._criteria[0]].dom.height();
                    }

                    // If there's nothing selected, unselect and unhighlight every
                    // criterion. Then exit this function, since there's nothing
                    // else to be done.
                    if (!total) {
                        this.iterateCriteria(function (criterion, index) {
                            updateCount(criterion, '');
                            unhighlight(criterion);
                            unselect(criterion);
                            resetHeight.call(this, criterion);
                        });
                        return;
                    }

                    // If we reached this point, then it means that there are criteria to be
                    // selected. Thus, for every criterion, check if it has a total in <criteriaTotals>
                    // If yes, do the following:
                    //      1. Update the text count
                    //      2. Check if it is supposed to be selected.  If yes, select it, otherwise
                    //         unselect it but highlight it.
                    //      3. Reset the height
                    // Else, the criterion is not supposed to be selected, therefore
                    //      1. unhighlight and unselected it
                    //      2. Update the text count to zero.
                    //      3. Decrease the height
                    this.iterateCriteria(function (criterion, index) {
                        if (criteriaTotals[criterion.id]) {
                            updateCount(criterion, criteriaTotals[criterion.id]);

                            if (criterion.__selected) {
                                select(criterion);
                            } else {
                                unselect(criterion);
                                highlight(criterion);
                            }
                            resetHeight.call(this, criterion);
                        } else {
                            unhighlight(criterion);
                            unselect(criterion);
                            updateCount(criterion, '');
                            decreaseHeight.call(this, criterion);
                        }
                    });
                    break;
                case 'arrange':

                    if (!this._itemOuterHeight) {
                        this._itemOuterHeight = this._data.criteria[this._criteria[0]].dom.outerHeight();
                    }

                    // For every criterion, check if it has a total in <criteriaTotals>
                    // If yes, do the following:
                    //      1. Update the text count
                    //      2. Check if it is supposed to be selected.   Otherwise, unselect it but highlight it.
                    //      3. Reset the height
                    // Else, the criterion is not supposed to be selected, therefore
                    //      1. unhighlight and unselected it
                    //      2. Update the text count to zero.
                    //      3. Decrease the height
                    //
                    // Additionaly, for both conditions, calculate the number of steps the criterion needs to move to reach
                    // it new position in the list
                    this.iterateCriteria(function (criterion, index) {
                        if (criteriaTotals[criterion.id]) {
                            updateCount(criterion, criteriaTotals[criterion.id]);

                            if (criterion.__selected) {
                                select(criterion);
                                steps = index - selectedCount;
                                selectedCount++;
                            } else {
                                unselect(criterion);
                                highlight(criterion);
                                steps = index - highlightedCount - (this._selectedTotal - selectedCount);
                            }

                            highlightedCount++;

                            move.call(this, criterion, index, -steps);
                        } else {
                            unhighlight(criterion);
                            unselect(criterion);
                            updateCount(criterion, '');

                            steps = this._highlightedTotal - highlightedCount;

                            move.call(this, criterion, index, steps);
                        }
                    });

                    if (!total) {
                        this.iterateCriteria(function (criterion, index) {
                            updateCount(criterion, criterion.itemsIndices.length);
                        });
                    } 
                    break;
            }

            if (animate) {
                this._$listContainer.animate({
                    scrollTop: 0
                }, ANIMATION_DURATION);
            }
        },
        clearSelection: function (list, trigger) {
            var criterion, i, criteriaLen;

            this.iterateCriteria(function (criterion, index) {
                criterion.__selected = false;
            });

            this._selectedTotal = 0;
        },
        onCriterionClick: function (e) {
            var id = parseInt(jQuery(e.target).closest('li').attr('data-cid')),
                criterion = this._data.criteria[id];

            criterion.__selected = !criterion.__selected;

            if (!criterion.__highlighted) {
                this._selectedTotal = 1;
            } else if (criterion.__selected) {
                this._selectedTotal++;
            } else {
                this._selectedTotal--;
            }

            this.trigger_selectionChanged([criterion]);
        },
        trigger_selectionChanged: function (data) {
            this._$.trigger('selectionChanged', {
                criteria: data
            });
        }
    };

    function findIntersection(l1, l2) {
        // Assumes that l1 and l2 are sorted and comparable
        var i, j, n, m, result = [];

        for (i = 0, n = l1.length, j = 0, m = l2.length; i < n && j < m;) {
            if (l1[i] > l2[j]) {
                j++;
            } else if (l1[i] < l2[j]) {
                i++;
            } else if (l1[i] === l2[j]) {
                result.push(l1[i]);
                i++;
                j++;
            }
        }

        return result;
    }

    Object.seal(ElasticList.defaultOptions);
    
    window.ElasticList = ElasticList;
})();