require('components/user/user.tpl')

require('services/util')
require('services/contexts')

class UserController {

  static $inject = [ '$routeParams', '$injector', 'User', 'Group', 'Orgs' ]

  constructor ($routeParams, $injector, User, Group, Orgs) {
    this.$injector = $injector

    let translate = $injector.get('translate')
    this.i18n = {}
    translate('user.updated', this.i18n)
    translate('user.error', this.i18n)
    translate('user.deleted', this.i18n)
    translate('user.content', this.i18n)
    translate('org.select', this.i18n)

    this.tabs = ['infos', 'groups', 'analytics', 'messages', 'logs', 'manage']
    this.tab = $routeParams.tab

    this.user = User.get({id: $routeParams.id}, (user) => {
      if (user.org && user.org !== '') {
        user.orgObj = Orgs.get({'id': user.org}, org => {
          user.validOrg = org.status === 'REGISTERED'
        })
      } else {
        user.validOrg = true
      }
      if (this.tab === 'messages') {
        this.messages = this.$injector.get('Email').query({id: this.user.uid})
      }
    })
    this.adminGroups = this.$injector.get('groupAdminList')()
    switch (this.tab) {
      case 'infos':
        this.contexts = $injector.get('Contexts').query()
        break
      case 'messages':
        this.templates = this.$injector.get('Templates').query()
        this.attachments = this.$injector.get('Attachments').query()
        break
      default:
    }
    this.bindGroups()

    this.required = $injector.get('UserRequired').get()
  }

  bindGroups () {
    const TMP_GROUP = 'TEMPORARY'

    // Load group infos for every tab (for confirmation)
    let Group = this.$injector.get('Group')
    this.groups = Group.query()

    this.user.$promise.then(() => {
      let groupAdminFilter = this.$injector.get('groupAdminFilter')
      let notAdmin = []
      this.$injector.get('$q').all([
        this.user.$promise,
        this.groups.$promise
      ]).then(() => {
        this.user.groups = this.user.groups || []
        this.user.adminGroups = this.user.adminGroups || {}
        this.groups.forEach((group) => {
          if (group.users.indexOf(this.user.uid) >= 0) {
            if (groupAdminFilter(group)) {
              this.user.adminGroups[group.cn] = true
            } else {
              this.user.groups.push(group.cn)
            }
          }
          if (!groupAdminFilter(group) && group.cn !== TMP_GROUP) {
            notAdmin.push(group.cn)
          }
          if (group.cn === 'PENDING') {
            this.user.pending = group.users.indexOf(this.user.uid) >= 0
          }
        })
        this.groups = notAdmin
      })
    })
  }

  loadAnalytics ($scope) {
    let date = this.$injector.get('date')

    this.date = {
      start: date.getFromDiff('year'),
      end: date.getEnd()
    }

    this.config = {
      layers: [ 'layer', 'count' ],
      requests: [ 'date', 'count' ],
      extractions: [ 'layer', 'count' ]
    }
    this.loadAnalyticsData()
  }

  loadAnalyticsData () {
    let i18n = {}
    let i18nPromise = this.$injector.get('translate')('analytics.errorload', i18n)
    let flash = this.$injector.get('Flash')

    this.$injector.get('$q').all([
      this.user.$promise,
      i18nPromise
    ]).then(() => {
      let error = flash.create.bind(flash, 'danger', i18n.errorload)
      let Analytics = this.$injector.get('Analytics')
      let options = {
        service: 'combinedRequests',
        user: this.user.uid,
        startDate: this.date.start,
        endDate: this.date.end
      }
      this.requests = Analytics.get(options, () => {}, error)

      let usageOptions = {
        ...options,
        service: 'layersUsage.json',
        limit: 10
      }
      this.layers = Analytics.get(usageOptions, () => {}, error)

      this.usageOptions = { ...usageOptions }
      delete this.usageOptions.limit
      this.usageOptions.service = 'layersUsage.csv'

      let extractionOptions = {
        ...options,
        service: 'layersExtraction.json',
        limit: 10
      }

      this.extractions = Analytics.get(extractionOptions, () => {}, error)
      this.extractionOptions = { ...extractionOptions }
      delete this.extractionOptions.limit
      this.extractionOptions.service = 'layersExtraction.csv'
    })
  }

  loadLogs ($scope) {
    let i18n = {}
    let flash = this.$injector.get('Flash')

    this.$injector.get('$q').all([
      this.user.$promise,
      this.$injector.get('translate')('analytics.errorload', i18n)
    ]).then(() => {
      this.logs = this.$injector.get('UserLogs').query(
        {
          id: this.user.uid,
          limit: 100000,
          page: 0
        },
        () => { this.logs.logs.reverse() },
        flash.create.bind(flash, 'danger', i18n.errorload)
      )
    })
  }

  save () {
    let flash = this.$injector.get('Flash')
    let $httpDefaultCache = this.$injector.get('$cacheFactory').get('$http')
    this.user.$update(() => {
      $httpDefaultCache.removeAll()
      flash.create('success', this.i18n.updated)
    }, flash.create.bind(flash, 'danger', this.i18n.error))
  }

  delete () {
    let $httpDefaultCache = this.$injector.get('$cacheFactory').get('$http')
    let flash = this.$injector.get('Flash')
    this.user.$delete(() => {
      $httpDefaultCache.removeAll()
      let $router = this.$injector.get('$router')
      $router.navigate($router.generate('users', { id: 'all' }))
      flash.create('success', this.i18n.deleted)
    }, flash.create.bind(flash, 'danger', this.i18n.error))
  }

  initCompose () {
    this.quill = new Quill(document.querySelector('#compose_content'), {
      modules: {
        toolbar: [
          [ { header: [ 1, 2, false ] } ],
          [ 'bold', 'italic', 'underline', 'image', {'color': []}, {'align': []} ]
        ]
      },
      placeholder: this.i18n.content,
      theme: 'snow'
    })
    this.quill.on('text-change', () => {
      this.compose.content = this.quill.container.firstChild.innerHTML
    })
  }

  openMessage (message) {
    message.trusted = this.$injector.get('$sce').trustAsHtml(message.body)
    this.message = message
  }

  closeMessage (message) {
    delete this.message
    delete this.compose
  }

  loadTemplate () {
    this.compose.subject = this.compose.template.name
    this.quill.setText(this.compose.template.content)
  }

  sendMail () {
    let flash = this.$injector.get('Flash')
    let Mail = this.$injector.get('Mail')
    let i18n = {}
    this.$injector.get('translate')('msg.sent', i18n)
    this.$injector.get('translate')('msg.error', i18n)
    let attachments = []
    for (let attachId in this.compose.attachments) {
      if (this.compose.attachments[attachId]) { attachments.push(attachId) }
    }
    (new Mail({
      id: this.user.uid,
      subject: this.compose.subject,
      content: this.compose.content,
      attachments: attachments.join(',')
    })).$save((r) => {
      delete this.compose
      flash.create('success', i18n.sent)
      let $httpDefaultCache = this.$injector.get('$cacheFactory').get('$http')
      $httpDefaultCache.removeAll()
      this.messages = this.$injector.get('Email').query({id: this.user.uid})
    }, () => { flash.create('danger', i18n.error) })
  }

  confirm () {
    angular.extend(this.user.adminGroups, {
      'PENDING': false,
      'USER': true
    })
    this.$injector.get('$cacheFactory').get('$http').removeAll()
  }

  activate ($scope) {
    const TMP_GROUP = 'TEMPORARY'
    let $httpDefaultCache = this.$injector.get('$cacheFactory').get('$http')
    let flash = this.$injector.get('Flash')

    let saveGroups = function (newVal, oldVal) {
      if (!newVal || !oldVal) { return }
      let removeTmp = g => g !== TMP_GROUP
      newVal = newVal.filter(removeTmp)
      oldVal = oldVal.filter(removeTmp)

      let toPut = newVal.filter(a => oldVal.indexOf(a) === -1)
      let toDel = oldVal.filter(a => newVal.indexOf(a) === -1)

      if (toPut.length === 0 && toDel.length === 0) { return }
      if (toPut.length > 1 && toDel.length === 0) { return } // Wrong artifacts

      let i18n = {}
      this.$injector.get('translate')('users.roleUpdated', i18n)
      this.$injector.get('translate')('users.roleUpdateError', i18n)

      this.groupPromise = this.$injector.get('GroupsUsers').save(
        {
          users: [ this.user.uid ],
          PUT: toPut,
          DELETE: toDel
        },
        () => {
          this.$injector.get('Group').query().$promise.then(groups => {
            groups.forEach(g => {
              if (g.cn === 'PENDING') {
                this.user.pending = g.users.indexOf(this.user.uid) >= 0
              }
            })
          })
          flash.create('success', i18n.roleUpdated)
          $httpDefaultCache.removeAll()
        },
        () => {
          flash.create('danger', i18n.roleUpdateError)
        }
      )
    }

    this.$injector.get('$q').all([
      this.user.$promise,
      this.groups.$promise
    ]).then(() => {
      $scope.$watch(() => this.user.groups, saveGroups.bind(this))

      let previousGroups
      $scope.$watchCollection(() => {
        let groups = []
        for (let g in this.user.adminGroups) {
          if (this.user.adminGroups[g]) { groups.push(g) }
        }
        if (this.user.adminGroups) {
          previousGroups = groups
          return groups
        } else {
          return previousGroups
        }
      }, saveGroups.bind(this))
    })

    if (this.tab === 'analytics') {
      this.loadAnalytics($scope)
    }
    if (this.tab === 'logs') {
      this.loadLogs($scope)
    }
  }
}

UserController.prototype.activate.$inject = [ '$scope' ]

angular.module('admin_console')
.controller('UserController', UserController)
.filter('encodeURIComponent', () => window.encodeURIComponent)
.directive('managers', [ '$timeout', 'User', ($timeout, User) => ({
  link: (scope, elm, attrs, ctrl) => {
    let promise = scope.$eval(attrs['promise'])
    let selUsers = []
    User.query((users) => {
      users.map((u) => {
        let id = u.uid
        selUsers.push({
          id: id,
          text: (u.sn || '') + ' ' + (u.givenName || '')
        })
      })
      elm.select2({
        placeholder: '',
        allowClear: true,
        data: selUsers
      })
      let cb = () => { $timeout(() => { elm.trigger('change') }) }
      if (promise) {
        promise.then(cb)
      } else {
        cb()
      }
    })
  }
})])
.directive('organizations', [ '$timeout', 'Orgs', ($timeout, Orgs) => ({
  link: (scope, elm, attrs, ctrl) => {
    let promise = scope.$eval(attrs['promise'])
    let user = scope.$eval(attrs['model'])

    // Initialize pending value for new user
    if (user.pending === undefined) {
      user.pending = false
    }
    let selOrgs = []
    Orgs.query((orgs) => {
      orgs.forEach((o) => {
        if (user.pending || o.status !== 'PENDING') {
          selOrgs.push({
            id: o.id,
            text: o.name
          })
        }
      })
      elm.select2({
        placeholder: '',
        allowClear: true,
        data: selOrgs
      })
      let cb = () => {
        $timeout(() => {
          elm.trigger('change')
        })
      }
      if (promise) {
        promise.then(cb)
      } else {
        cb()
      }
    })
  }
})])

