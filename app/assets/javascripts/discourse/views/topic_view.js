/**
  This view is for rendering an icon representing the status of a topic

  @class TopicView
  @extends Discourse.View
  @namespace Discourse
  @uses Discourse.Scrolling
  @module Discourse
**/
Discourse.TopicView = Discourse.View.extend(Discourse.Scrolling, {
  templateName: 'topic',
  topicBinding: 'controller.content',
  userFiltersBinding: 'controller.userFilters',
  classNameBindings: ['controller.multiSelect:multi-select', 'topic.archetype', 'topic.category.secure:secure_category'],
  progressPosition: 1,
  menuVisible: true,
  SHORT_POST: 1200,

  postStream: Em.computed.alias('controller.postStream'),

  // Update the progress bar using sweet animations
  updateBar: function() {
    if (!this.get('postStream.loaded')) return;

    var $topicProgress = $('#topic-progress');
    if (!$topicProgress.length) return;

    var ratio = this.get('progressPosition') / this.get('postStream.filteredPostsCount');
    var totalWidth = $topicProgress.width();
    var progressWidth = ratio * totalWidth;
    var bg = $topicProgress.find('.bg');
    bg.stop(true, true);
    var currentWidth = bg.width();

    if (currentWidth === totalWidth) {
      bg.width(currentWidth - 1);
    }

    if (progressWidth === totalWidth) {
      bg.css("border-right-width", "0px");
    } else {
      bg.css("border-right-width", "1px");
    }

    if (currentWidth === 0) {
      bg.width(progressWidth);
    } else {
      bg.animate({ width: progressWidth }, 400);
    }
  }.observes('progressPosition', 'postStream.filteredPostsCount', 'topic.loaded'),

  updateTitle: function() {
    var title = this.get('topic.title');
    if (title) return Discourse.set('title', title);
  }.observes('topic.loaded', 'topic.title'),

  currentPostChanged: function() {
    var current = this.get('controller.currentPost');

    var topic = this.get('topic');
    if (!(current && topic)) return;

    if (current > (this.get('maxPost') || 0)) {
      this.set('maxPost', current);
    }

    var postUrl = topic.get('url');
    if (current > 1) { postUrl += "/" + current; }
    Discourse.URL.replaceState(postUrl);
  }.observes('controller.currentPost', 'postStream.highest_post_number'),

  composeChanged: function() {
    var composerController = Discourse.get('router.composerController');
    composerController.clearState();
    composerController.set('topic', this.get('topic'));
  }.observes('composer'),

  // This view is being removed. Shut down operations
  willDestroyElement: function() {

    this.unbindScrolling();
    $(window).unbind('resize.discourse-on-scroll');

    // Unbind link tracking
    this.$().off('mouseup.discourse-redirect', '.cooked a, a.track-link');

    this.get('controller').set('onPostRendered', null);

    this.resetExamineDockCache();

    // this happens after route exit, stuff could have trickled in
    this.set('controller.controllers.header.showExtraInfo', false);
  },

  didInsertElement: function(e) {
    this.bindScrolling({debounce: 0});

    var topicView = this;
    $(window).bind('resize.discourse-on-scroll', function() { topicView.updatePosition(false); });

    var controller = this.get('controller');
    controller.set('onPostRendered', function(){
      topicView.postsRendered(topicView);
    });

    this.$().on('mouseup.discourse-redirect', '.cooked a, a.track-link', function(e) {
      return Discourse.ClickTrack.trackClick(e);
    });

    this.updatePosition(true);
  },

  debounceLoadSuggested: Discourse.debounce(function(){
    if (this.get('isDestroyed') || this.get('isDestroying')) { return; }

    var incoming = this.get('topicTrackingState.newIncoming');
    var suggested = this.get('topic.details.suggested_topics');
    var topicId = this.get('topic.id');

    if(suggested) {

      var existing = _.invoke(suggested, 'get', 'id');

      var lookup = _.chain(incoming)
        .last(5)
        .reverse()
        .union(existing)
        .uniq()
        .without(topicId)
        .first(5)
        .value();

      Discourse.TopicList.loadTopics(lookup, "").then(function(topics){
        suggested.clear();
        suggested.pushObjects(topics);
      });
    }
  }, 1000),

  hasNewSuggested: function(){
    this.debounceLoadSuggested();
  }.observes('topicTrackingState.incomingCount'),

  // Triggered whenever any posts are rendered, debounced to save over calling
  postsRendered: Discourse.debounce(function() {
    this.updatePosition(false);
  }, 50),

  resetRead: function(e) {
    Discourse.ScreenTrack.instance().reset();
    this.get('controller').unsubscribe();

    var topicView = this;
    this.get('topic').resetRead().then(function() {
      topicView.set('controller.message', Em.String.i18n("topic.read_position_reset"));
      topicView.set('controller.loaded', false);
    });
  },

  gotFocus: function(){
    if (Discourse.get('hasFocus')){
      this.scrolled();
    }
  }.observes("Discourse.hasFocus"),

  getPost: function($post){
    var post, postView;
    postView = Ember.View.views[$post.prop('id')];
    if (postView) {
      return postView.get('post');
    }
    return null;
  },

  // Called for every post seen, returns the post number
  postSeen: function($post) {
    var post = this.getPost($post);

    if (post) {
      var postNumber = post.get('post_number');
      if (postNumber > (this.get('postStream.last_read_post_number') || 0)) {
        this.set('postStream.last_read_post_number', postNumber);
      }
      if (!post.get('read')) {
        post.set('read', true);
      }
      return post.get('post_number');
    }
  },

  resetExamineDockCache: function() {
    this.docAt = null;
    this.dockedTitle = false;
    this.dockedCounter = false;
  },

  updateDock: function(postView) {
    if (!postView) return;
    var post = postView.get('post');
    if (!post) return;
    this.set('progressPosition', this.get('postStream').indexOf(post) + 1);
  },

  nonUrgentPositionUpdate: Discourse.debounce(function(opts) {
    Discourse.ScreenTrack.instance().scrolled();
    var model = this.get('controller.model');
    if (model) {
      this.set('controller.currentPost', opts.currentPost);
    }
  },500),

  scrolled: function(){
    this.updatePosition(true);
  },

  updatePosition: function(userActive) {

    var topic = this.get('controller.model');

    var rows = $('.topic-post');
    if (!rows || rows.length === 0) { return; }

    // if we have no rows
    var info = Discourse.Eyeline.analyze(rows);
    if(!info) { return; }

    // are we scrolling upwards?
    if(info.top === 0 || info.onScreen[0] === 0 || info.bottom === 0) {
      var $body = $('body');
      var $elem = $(rows[0]);
      var distToElement = $body.scrollTop() - $elem.position().top;
      this.get('postStream').prependMore().then(function() {
        Em.run.next(function () {
          $('html, body').scrollTop($elem.position().top + distToElement);
        });
      });
    }

    // are we scrolling down?
    var currentPost;
    if(info.bottom === rows.length-1) {
      currentPost = this.postSeen($(rows[info.bottom]));
      this.get('postStream').appendMore();
    }

    // update dock
    this.updateDock(Ember.View.views[rows[info.bottom].id]);

    // mark everything on screen read
    var topicView = this;
    _.each(info.onScreen,function(item){
      var seen = topicView.postSeen($(rows[item]));
      currentPost = currentPost || seen;
    });

    var currentForPositionUpdate = currentPost;
    if (!currentForPositionUpdate) {
      var postView = this.getPost($(rows[info.bottom]));
      if (postView) { currentForPositionUpdate = postView.get('post_number'); }
    }

    if (currentForPositionUpdate) {
      this.nonUrgentPositionUpdate({
        userActive: userActive,
        currentPost: currentPost || currentForPositionUpdate
      });
    } else {
      console.error("can't update position ");
    }

    var offset = window.pageYOffset || $('html').scrollTop();
    var firstLoaded = topic.get('postStream.firstPostLoaded');
    if (!this.docAt) {
      var title = $('#topic-title');
      if (title && title.length === 1) {
        this.docAt = title.offset().top;
      }
    }

    var headerController = this.get('controller.controllers.header');
    if (this.docAt) {
      headerController.set('showExtraInfo', offset >= this.docAt || !firstLoaded);
    } else {
      headerController.set('showExtraInfo', !firstLoaded);
    }

    // there is a whole bunch of caching we could add here
    var $lastPost = $('.last-post');
    var lastPostOffset = $lastPost.offset();
    if (!lastPostOffset) return;

    if (offset >= (lastPostOffset.top + $lastPost.height()) - $(window).height()) {
      if (!this.dockedCounter) {
        $('#topic-progress-wrapper').addClass('docked');
        this.dockedCounter = true;
      }
    } else {
      if (this.dockedCounter) {
        $('#topic-progress-wrapper').removeClass('docked');
        this.dockedCounter = false;
      }
    }
  },

  topicTrackingState: function() {
    return Discourse.TopicTrackingState.current();
  }.property(),

  browseMoreMessage: function() {
    var opts = {
      latestLink: "<a href=\"/\">" + (Em.String.i18n("topic.view_latest_topics")) + "</a>"
    };

    var category = this.get('controller.content.category');
    if (category) {
      opts.catLink = Discourse.Utilities.categoryLink(category);
    } else {
      opts.catLink = "<a href=\"" + Discourse.getURL("/categories") + "\">" + (Em.String.i18n("topic.browse_all_categories")) + "</a>";
    }

    var tracking = this.get('topicTrackingState');

    var unreadTopics = tracking.countUnread();
    var newTopics = tracking.countNew();

    if (newTopics + unreadTopics > 0) {
      var hasBoth = unreadTopics > 0 && newTopics > 0;

      return I18n.messageFormat("topic.read_more_MF", {
        "BOTH": hasBoth,
        "UNREAD": unreadTopics,
        "NEW": newTopics,
        "CATEGORY": category ? true : false,
        latestLink: opts.latestLink,
        catLink: opts.catLink
      });
    }
    else if (category) {
      return Ember.String.i18n("topic.read_more_in_category", opts);
    } else {
      return Ember.String.i18n("topic.read_more", opts);
    }
  }.property('topicTrackingState.messageCount')

});

Discourse.TopicView.reopenClass({

  // Scroll to a given post, if in the DOM. Returns whether it was in the DOM or not.
  jumpToPost: function(topicId, postNumber) {
    Em.run.scheduleOnce('afterRender', function() {
      // Make sure we're looking at the topic we want to scroll to
      if (topicId !== parseInt($('#topic').data('topic-id'), 10)) { return false; }

      var $post = $("#post_" + postNumber);
      if ($post.length) {
        if (postNumber === 1) {
          $('html, body').scrollTop(0);
        } else {
          var header = $('header');
          var title = $('#topic-title');
          var expectedOffset = title.height() - header.find('.contents').height();

          if (expectedOffset < 0) {
            expectedOffset = 0;
          }

          $('html, body').scrollTop($post.offset().top - (header.outerHeight(true) + expectedOffset));

          var $contents = $('.topic-body .contents', $post);
          var originalCol = $contents.css('backgroundColor');
          $contents.css({ backgroundColor: "#ffffcc" }).animate({ backgroundColor: originalCol }, 2500);
        }
      }
    });
  }
});
