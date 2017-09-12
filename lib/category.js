'use strict';


var async = require('async');
var nconf = require('nconf');

var db = require.main.require('./src/database');
var privileges = require.main.require('./src/privileges');
var user = require.main.require('./src/user');
var categories = require.main.require('./src/categories');
var meta = require.main.require('./src/meta');
var pagination = require.main.require('./src/pagination');
var helpers = require.main.require('./src/controllers/helpers');
var utils = require.main.require('./src/utils');
var translator = require.main.require('./src/translator');


var categoryController = module.exports;

categoryController.get = function (req, res, callback) {
	var cid = req.params.category_id;
	var currentPage = parseInt(req.query.page, 10) || 1;
	var pageCount = 1;
	var userPrivileges;
	var settings;
	var rssToken;

	if ((req.params.topic_index && !utils.isNumber(req.params.topic_index)) || !utils.isNumber(cid)) {
		return callback();
	}
	async.waterfall([
		function (next) {
			async.parallel({
				categoryData: function (next) {
					categories.getCategoryFields(cid, ['slug', 'disabled', 'topic_count'], next);
				},
				privileges: function (next) {
					privileges.categories.get(cid, req.uid, next);
				},
				userSettings: function (next) {
					user.getSettings(req.uid, next);
				},
				rssToken: function (next) {
					user.auth.getFeedToken(req.uid, next);
				},
			}, next);
		},
		function (results, next) {
			userPrivileges = results.privileges;
			rssToken = results.rssToken;

			if (!results.categoryData.slug || (results.categoryData && parseInt(results.categoryData.disabled, 10) === 1)) {
				return callback();
			}

			if (!results.privileges.read) {
				return helpers.notAllowed(req, res);
			}

			if (!res.locals.isAPI && (!req.params.slug || results.categoryData.slug !== cid + '/' + req.params.slug) && (results.categoryData.slug && results.categoryData.slug !== cid + '/')) {
				return helpers.redirect(res, '/category/' + results.categoryData.slug);
			}

			settings = results.userSettings;
			var topicIndex = utils.isNumber(req.params.topic_index) ? parseInt(req.params.topic_index, 10) - 1 : 0;
			var topicCount = parseInt(results.categoryData.topic_count, 10);
			pageCount = Math.max(1, Math.ceil(topicCount / settings.topicsPerPage));

			if (topicIndex < 0 || topicIndex > Math.max(topicCount - 1, 0)) {
				return helpers.redirect(res, '/category/' + cid + '/' + req.params.slug + (topicIndex > topicCount ? '/' + topicCount : ''));
			}

			if (settings.usePagination && (currentPage < 1 || currentPage > pageCount)) {
				return callback();
			}

			if (!settings.usePagination) {
				topicIndex = Math.max(0, topicIndex - (Math.ceil(settings.topicsPerPage / 2) - 1));
			} else if (!req.query.page) {
				var index = Math.max(parseInt((topicIndex || 0), 10), 0);
				currentPage = Math.ceil((index + 1) / settings.topicsPerPage);
				topicIndex = 0;
			}

			var set = 'cid:' + cid + ':tids';
			var reverse = false;
			// `sort` qs has priority over user setting
			var sort = req.query.sort || settings.categoryTopicSort;
			if (sort === 'newest_to_oldest') {
				reverse = true;
			} else if (sort === 'most_posts') {
				reverse = true;
				set = 'cid:' + cid + ':tids:posts';
			}

			var start = ((currentPage - 1) * settings.topicsPerPage) + topicIndex;
			var stop = start + settings.topicsPerPage - 1;

			var payload = {
				cid: cid,
				set: set,
				reverse: reverse,
				start: start,
				stop: stop,
				uid: req.uid,
				settings: settings,
			};

			async.waterfall([
				function (next) {
					user.getUidByUserslug(req.query.author, next);
				},
				function (uid, next) {
					payload.targetUid = uid;
					if (uid) {
						payload.set = 'cid:' + cid + ':uid:' + uid + ':tids';
					}

					if (req.query.tag) {
						if (Array.isArray(req.query.tag)) {
							payload.set = [payload.set].concat(req.query.tag.map(function (tag) {
								return 'tag:' + tag + ':topics';
							}));
						} else {
							payload.set = [payload.set, 'tag:' + req.query.tag + ':topics'];
						}
					}
					categories.getCategoryById(payload, next);
				},
			], next);
		},
		function (categoryData, next) {
			categories.modifyTopicsByPrivilege(categoryData.topics, userPrivileges);

			if (categoryData.link) {
				db.incrObjectField('category:' + categoryData.cid, 'timesClicked');
				return helpers.redirect(res, categoryData.link);
			}

			buildBreadcrumbs(categoryData, next);
		},
		function (categoryData, next) {
			if (!categoryData.children.length) {
				return next(null, categoryData);
			}

			var allCategories = [];
			categories.flattenCategories(allCategories, categoryData.children);
			categories.getRecentTopicReplies(allCategories, req.uid, function (err) {
				next(err, categoryData);
			});
		},
		function (categoryData) {
			categoryData.description = translator.escape(categoryData.description);
			categoryData.privileges = userPrivileges;
			categoryData.showSelect = categoryData.privileges.editable;
			categoryData.rssFeedUrl = nconf.get('url') + '/category/' + categoryData.cid + '.rss';
			if (parseInt(req.uid, 10)) {
				categories.markAsRead([cid], req.uid);
				categoryData.rssFeedUrl += '?uid=' + req.uid + '&token=' + rssToken;
			}

			addTags(categoryData, res);

			categoryData['feeds:disableRSS'] = parseInt(meta.config['feeds:disableRSS'], 10) === 1;
			categoryData.title = translator.escape(categoryData.name);
			pageCount = Math.max(1, Math.ceil(categoryData.topic_count / settings.topicsPerPage));
			categoryData.pagination = pagination.create(currentPage, pageCount, req.query);
			categoryData.pagination.rel.forEach(function (rel) {
				rel.href = nconf.get('url') + '/category/' + categoryData.slug + rel.href;
				res.locals.linkTags.push(rel);
			});
			
			res.render('category', categoryData);
		},
	], callback);
};


function buildBreadcrumbs(categoryData, callback) {
	var breadcrumbs = [
		{
			text: categoryData.name,
			url: nconf.get('relative_path') + '/category/' + categoryData.slug,
		},
	];
	async.waterfall([
		function (next) {
			helpers.buildCategoryBreadcrumbs(categoryData.parentCid, next);
		},
		function (crumbs, next) {
			categoryData.breadcrumbs = crumbs.concat(breadcrumbs);
			next(null, categoryData);
		},
	], callback);
}

function addTags(categoryData, res) {
	res.locals.metaTags = [
		{
			name: 'title',
			content: categoryData.name,
		},
		{
			property: 'og:title',
			content: categoryData.name,
		},
		{
			name: 'description',
			content: categoryData.description,
		},
		{
			property: 'og:type',
			content: 'website',
		},
	];

	if (categoryData.backgroundImage) {
		res.locals.metaTags.push({
			name: 'og:image',
			content: categoryData.backgroundImage,
		});
	}

	res.locals.linkTags = [
		{
			rel: 'alternate',
			type: 'application/rss+xml',
			href: categoryData.rssFeedUrl,
		},
		{
			rel: 'up',
			href: nconf.get('url'),
		},
	];
}